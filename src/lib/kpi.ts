// KPI ダッシュボードの集計ロジック。
//   ・期間（日/週/月/四半期/任意）から開始日・終了日を作る
//   ・proposals / meetings から指標ごとの実績件数を集計
//   ・kpi_targets から目標値を取得し、期間に合わせて換算（週次が正、他は按分）
//
// JST 前提で week は月曜始まり、business days は月〜金で計算。

import { engerAdmin } from "./supabase";
import { ownerMatches } from "./owner-match";

export type PeriodType = "day" | "week" | "month" | "quarter" | "custom";

// 指標（2026/06 改訂）。提案以外は CL担当（closer）に加算する。
//   proposal  : 提案。期間内に作成され、現在ステータスが「提案中」以降の提案を提案者に加算
//                （所属確認フォルダ・承認待ち・失注/見送りは除外）。
//               承認待ち・差戻し中（=まだ提案として確定していない）のみ除外。所属確認/提案中以降や
//               見送り/失注/稼働は「作成された提案」として計上する。
//   contact   : コンタクト数。架電状況が「未架電」「空白」以外＝接触済。CL に加算。
//   adjusting : 調整中。案件/人材の通知のいずれか一方でも「処理中(in_progress)」か「完了(done)」になったら加算。
//               両方とも「未処理(pending)」に戻ったら計上しない（スナップショット再計算で減算が自然に成立）。
//   schedule  : 日程確定。提案管理のステータスが現在「面談」のもの（＝面談フォルダにあるもの）。CL に加算。
//               合格/稼働へ進んだもの・見送り/失注・面談前（所属確認/提案中等）は対象外。
//               ＝ ステージが「面談」から変われば自然に外れる（提案管理の面談フォルダ件数と一致）。
//   deal      : 成約数。「合格」に到達したら計上。以後「稼働」へ進んでも維持（減算なし）。
export type Metric = "proposal" | "contact" | "adjusting" | "schedule" | "deal";

// 表示ラベルは営業マニュアル§10（提案/面談/合格/稼働）に準拠。
//   ・schedule＝「面談」（旧:日程確定）／deal＝「合格」（旧:成約＝稼働決定）。
//   ・DBの指標キー(proposal/contact/adjusting/schedule/deal)は変更しない（表示のみ統一）。
export const METRIC_LABELS: Record<Metric, { short: string; long: string; tone: string }> = {
  proposal:  { short: "提案",       long: "新規提案",       tone: "#0095D9" },
  contact:   { short: "コンタクト", long: "架電・接触",     tone: "#7c3aed" },
  adjusting: { short: "調整中",     long: "処理着手",       tone: "#0e7490" },
  schedule:  { short: "面談",       long: "日程確定・面談", tone: "#b45309" },
  deal:      { short: "合格",       long: "合格（稼働決定）", tone: "#067647" },
};

export const METRIC_ORDER: Metric[] = ["proposal", "contact", "adjusting", "schedule", "deal"];

// 各指標の「この提案は該当するか」を判定する条件（snapshot/history で共通利用）。
//   ※ 集計タイミングは呼び出し側で created_at / stage_updated_at / updated_at を期間判定する。
//   ※ イベント加算/減算は履歴を持たないため「現在状態のスナップショット述語」で正味の結果を表現する。
const NOT_CONTACTED = new Set(["", "未架電", "—"]);
// 通知ステータスの実体値は英語（pending=未処理 / in_progress=処理中 / done=完了）。
const NOTIFY_STARTED = new Set(["in_progress", "done"]); // 処理中 or 完了（＝着手済み）
// 日程確定の母数：現在のステータスが「面談」のもの＝提案管理の面談フォルダにあるもの。
//   定義：ステータス=面談 の数を CL担当に加算。合格/稼働へ進んだもの・見送り/失注・面談前は対象外。
//   旧ステージ名（面談調整/クロージング中）は normalizeStage 同様「面談」に含める。
//   ※ 以前は 合格/稼働/見送り 等も含めていたため、面談フォルダが空でも数値が出る不具合があった。
const SCHEDULE_STAGES = new Set(["面談", "面談調整", "クロージング中"]);
// 成約：「合格」に到達済み（稼働へ進んでも維持）。旧ステージ名も吸収。
const DEAL_STAGES = new Set(["合格", "面談合格", "稼働", "稼働決定"]);
// 提案：ステータスが「提案中」以降に到達したもの（提案者に加算）。
//   承認待ち・所属確認（提案前）は対象外。旧ステージ名も吸収。
//   ＝「ステータスが提案中に変わったら提案者に＋1」を表す母数。
const PROPOSED_STAGES = new Set([
  "提案中", "提案済", "返信待ち", "返信あり", "確認中",
  "面談", "面談調整", "クロージング中",
  "合格", "面談合格", "稼働", "稼働決定",
]);
// 提案後に流れた（見送り/失注）ステージ。提案という「活動」は起きた事実なので、
//   KPI(提案/コンタクト/調整中)では見送り後も件数を維持する（活動量メトリクスは遡って消さない）。
//   ※ 成約(合格)・日程確定(面談) は "現在の到達状態" を表すため、見送りになれば自然に外れる。
const PASSED_STAGES = new Set(["見送り", "失注"]);
export const metricFlags = {
  // 提案：提案中以降に到達 OR 提案後に見送り/失注になったもの（提案前=承認待ち/所属確認は除外）。
  //   見送りでも「提案した実績」は活動量として残す。
  isProposed: (p: any) => {
    const s = String(p?.stage ?? "").trim();
    return PROPOSED_STAGES.has(s) || PASSED_STAGES.has(s);
  },
  // コンタクト：架電状況が「未架電/空白」以外＝接触済み
  isContact: (p: any) => {
    const c = String(p.caller_status ?? "").trim();
    return c !== "" && !NOT_CONTACTED.has(c);
  },
  // 調整中：案件/人材の通知のいずれか一方でも「処理中」or「完了」なら該当（両方「未処理」のみ非該当）
  isAdjusting: (p: any) => {
    const j = String(p.job_notify_status ?? "").trim();
    const k = String(p.cand_notify_status ?? "").trim();
    return NOTIFY_STARTED.has(j) || NOTIFY_STARTED.has(k);
  },
  // 日程確定：「面談」到達済み（合格/見送り/稼働を含む。失注・面談前は非該当）
  isSchedule: (p: any) => SCHEDULE_STAGES.has(String(p.stage ?? "").trim()),
  // 成約：「合格」到達済み（稼働を含む）
  isDeal: (p: any) => DEAL_STAGES.has(String(p.stage ?? "").trim()),
};

// ── 期間ヘルパ ────────────────────────────────────────────────────────
const JST_OFFSET_MIN = 9 * 60;

// 累計（積み上げ）リセット境界の判定キー（JST基準）。月キー / 四半期キー。
//   cumulate="month" は同一年月で、 "quarter" は同一年・四半期で running を継続し、
//   キーが変わったら running をリセットする。 "all" は常に同一キー（"ALL"）でリセットなし。
const ymKey = (d: Date) => { const j = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000); return `${j.getUTCFullYear()}-${j.getUTCMonth()}`; };
const yqKey = (d: Date) => { const j = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000); return `${j.getUTCFullYear()}-Q${Math.floor(j.getUTCMonth() / 3)}`; };
const cumulateKeyOf = (d: Date, mode: "month" | "quarter" | "all" | "off") =>
  mode === "month" ? ymKey(d) : mode === "quarter" ? yqKey(d) : "ALL";

/** JST の「今日」の 00:00 を表す Date を返す（実体は UTC で +9h 補正）。 */
export function jstStartOfDay(d: Date = new Date()): Date {
  const utc = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000);
  utc.setUTCHours(0, 0, 0, 0);
  return new Date(utc.getTime() - JST_OFFSET_MIN * 60 * 1000);
}

/** その週の月曜 00:00（JST）。 */
export function jstStartOfWeek(d: Date = new Date()): Date {
  const day = jstStartOfDay(d);
  const jstDow = (new Date(day.getTime() + JST_OFFSET_MIN * 60 * 1000)).getUTCDay(); // 0=日…6=土
  const offset = (jstDow + 6) % 7; // 月曜まで戻すオフセット
  return new Date(day.getTime() - offset * 86400000);
}

export function jstStartOfMonth(d: Date = new Date()): Date {
  const j = new Date(jstStartOfDay(d).getTime() + JST_OFFSET_MIN * 60 * 1000);
  j.setUTCDate(1);
  return new Date(j.getTime() - JST_OFFSET_MIN * 60 * 1000);
}

export function jstStartOfQuarter(d: Date = new Date()): Date {
  const j = new Date(jstStartOfDay(d).getTime() + JST_OFFSET_MIN * 60 * 1000);
  const qMonth = Math.floor(j.getUTCMonth() / 3) * 3;
  j.setUTCMonth(qMonth, 1);
  return new Date(j.getTime() - JST_OFFSET_MIN * 60 * 1000);
}

export function addDays(d: Date, n: number) { return new Date(d.getTime() + n * 86400000); }
export function addMonths(d: Date, n: number) {
  const j = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000);
  j.setUTCMonth(j.getUTCMonth() + n);
  return new Date(j.getTime() - JST_OFFSET_MIN * 60 * 1000);
}

/** 期間種別と「今日」から [start, end) を返す（end は exclusive）。 */
export function resolveRange(type: PeriodType, base: Date = new Date(), custom?: { from: string; to: string }): { start: Date; end: Date } {
  if (type === "day")   { const s = jstStartOfDay(base);   return { start: s, end: addDays(s, 1) }; }
  if (type === "week")  { const s = jstStartOfWeek(base);  return { start: s, end: addDays(s, 7) }; }
  if (type === "month") { const s = jstStartOfMonth(base); return { start: s, end: addMonths(s, 1) }; }
  if (type === "quarter") { const s = jstStartOfQuarter(base); return { start: s, end: addMonths(s, 3) }; }
  // custom: 'YYYY-MM-DD' 〜 'YYYY-MM-DD'（end は inclusive で受け取り、exclusive に変換）
  const f = custom?.from ? new Date(`${custom.from}T00:00:00+09:00`) : jstStartOfWeek(base);
  const t = custom?.to   ? new Date(`${custom.to}T00:00:00+09:00`)   : jstStartOfDay(base);
  return { start: f, end: addDays(t, 1) };
}

/** タブごとの「累計レンジ」を返す。実績・目標を積み上げ（累計）表示する際の集計範囲。
 *   - day  → 「月初〜今日（exclusive: 翌日0時）」… 月初からの累計
 *   - week → 「月初〜今週末（exclusive: 来週月曜0時）」… 月初からの累計（その週の月曜が属する月で判定）
 *   - month → 月単体（その月＝累計の単位）
 *   - quarter → その四半期の開始〜終了（四半期内で累計）
 *   - custom → 指定範囲そのまま（範囲全体で累計）
 *   達成率カード（getKpiSnapshot）・推移グラフ（getKpiHistory）・推移テーブル（getKpiHistoryTable）
 *   の全てがこのルールで累計表示するよう統一している。 */
export function cumulativeRange(type: PeriodType, base: Date = new Date(), custom?: { from: string; to: string }): { start: Date; end: Date } {
  if (type === "day" || type === "week") {
    const single = resolveRange(type, base);
    const monthStart = jstStartOfMonth(type === "week" ? jstStartOfWeek(base) : base);
    return { start: monthStart, end: single.end };
  }
  // それ以外は resolveRange と同じ（month=単体、quarter=四半期内、custom=範囲全体）
  return resolveRange(type, base, custom);
}

/** タブ種別 → 累計（積み上げ）リセット境界。画面全体（カード/グラフ/テーブル）で共通利用する。
 *   - 日・週   → "month"   … 月初リセット（その月分のみ積み上げ）
 *   - 四半期   → "quarter" … 四半期境界でリセット（四半期内で積み上げ）
 *   - 任意     → "all"     … リセットなし（表示範囲の開始から積み上げ）
 *   - 月       → "month"   … 月単位がそのまま累計単位（各月単体＝その月の累計） */
export function cumulateMode(type: PeriodType): "month" | "quarter" | "all" {
  if (type === "quarter") return "quarter";
  if (type === "custom")  return "all";
  return "month"; // day / week / month
}

/** 期間内の営業日数（月〜金）。スケーリング用。 */
export function businessDaysInRange(start: Date, end: Date): number {
  let n = 0;
  for (let t = start.getTime(); t < end.getTime(); t += 86400000) {
    const jstDow = (new Date(t + JST_OFFSET_MIN * 60 * 1000)).getUTCDay();
    if (jstDow >= 1 && jstDow <= 5) n++;
  }
  return n;
}

/** 週次目標を期間に按分。 */
export function scaleWeeklyTarget(weekly: number, type: PeriodType, range: { start: Date; end: Date }): number {
  if (weekly <= 0) return 0;
  if (type === "week")    return weekly;
  if (type === "day")     return Math.round(weekly / 5);
  if (type === "month")   return Math.round(weekly * 4.33);
  if (type === "quarter") return weekly * 13;
  // custom
  const bd = businessDaysInRange(range.start, range.end);
  return Math.round((weekly * bd) / 5);
}

const iso = (d: Date) => d.toISOString();

// ── 実績の集計 ───────────────────────────────────────────────────────

export type KpiSnapshot = Record<Metric, { target: number; actual: number; pct: number }>;

/** scope='person' の場合は owner.name（staff.name）を使う。team の場合は owner=null。 */
export async function getKpiSnapshot(opts: {
  ownerName: string | null;       // null なら全社（チーム集計時）
  type: PeriodType;
  base?: Date;
  custom?: { from: string; to: string };
  weeklyTargets?: Partial<Record<Metric, number>>; // 取得済みの週次目標
  cumulate?: boolean;             // true=累計レンジで実績・目標を積み上げ（cumulativeRange のルール）
}): Promise<{ range: { start: Date; end: Date }; snapshot: KpiSnapshot }> {
  // 累計表示時は集計レンジを月初〜（日/週）等に拡張し、実績・目標とも積み上げる。
  //   目標は週次目標を「レンジ内の営業日数」で按分（scaleWeeklyTarget の custom 経路）し、
  //   実績は拡張レンジ内のイベント実数を数えるため、両者が同じ期間で揃う。
  const range = opts.cumulate
    ? cumulativeRange(opts.type, opts.base, opts.custom)
    : resolveRange(opts.type, opts.base, opts.custom);
  const sb = engerAdmin();
  const start = iso(range.start), end = iso(range.end);

  // 提案系: proposals を広めに取得し、本人判定はJS側で（略称↔フルネームに耐性）。
  //   旧スキーマ（通知/架電列なし）でも落ちないよう列をフォールバック。
  //   approval_status も取得：承認待ち/差戻し中は「まだ提案として実施されていない」ため
  //   KPI(proposal) から除外する。承認後（approval_status=approved or NULL=旧データ）のみ加算。
  let r: any = await sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status, approval_status")
    .or(`created_at.gte.${start},stage_updated_at.gte.${start},updated_at.gte.${start}`)
    .limit(8000);
  if (r.error && /approval_status|column/i.test(r.error.message ?? "")) {
    r = await sb.from("proposals")
      .select("id, proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status")
      .or(`created_at.gte.${start},stage_updated_at.gte.${start},updated_at.gte.${start}`)
      .limit(8000);
  }
  if (r.error) r = await sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at")
    .or(`created_at.gte.${start},stage_updated_at.gte.${start}`)
    .limit(8000);
  const props: any[] = r.error ? [] : (r.data ?? []);

  const inRange = (d: string | null) => !!d && d >= start && d < end;
  // 提案は「提案者(proposer)」に計上（メンバー別アクティビティ表と同一基準で揃える）。
  //   以前は proposer OR closer で計上していたため、CL担当だけ本人の提案がアクティビティ表より
  //   多く出てサマリーカードと乖離していた。表＝正としてここを proposer 一致に統一する。
  const isProposer = (p: any) =>
    !opts.ownerName || ownerMatches(opts.ownerName, p.proposer);
  // それ以外の指標は CL担当（closer）に計上。
  const isCloser = (p: any) => !opts.ownerName || ownerMatches(opts.ownerName, p.closer);
  // 承認待ち / 差戻し は「まだ提案として実施されていない」ためKPIから除外（既存提案は approval_status=approved or NULL=旧データ）。
  const isApproved = (p: any) => {
    const s = String(p?.approval_status ?? "").trim();
    return s !== "pending" && s !== "rejected";
  };
  const a = metricFlags;

  let proposal = 0, contact = 0, adjusting = 0, schedule = 0, deal = 0;
  for (const p of props) {
    // 提案：現在ステータスが「提案中」以降のみ計上（所属確認・承認待ち・失注/見送りは除外）。
    if (isApproved(p) && a.isProposed(p) && isProposer(p) && inRange(p.created_at)) proposal++;
    if (!isCloser(p)) continue;
    const ev = p.stage_updated_at ?? p.updated_at ?? null;     // ステージ変化の起点
    const evAny = p.updated_at ?? p.stage_updated_at ?? null;  // 任意更新（架電/通知）の起点
    if (a.isContact(p)   && inRange(evAny)) contact++;
    if (a.isAdjusting(p) && inRange(evAny)) adjusting++;
    if (a.isSchedule(p)  && inRange(ev))    schedule++;
    if (a.isDeal(p)      && inRange(ev))    deal++;
  }

  const actuals: Record<Metric, number> = { proposal, contact, adjusting, schedule, deal };
  const w = opts.weeklyTargets ?? {};
  const snapshot = {} as KpiSnapshot;
  for (const m of METRIC_ORDER) {
    // 累計時はレンジ内営業日数で按分（custom 経路）。非累計は従来どおりタブ単位で換算。
    const target = scaleWeeklyTarget(w[m] ?? 0, opts.cumulate ? "custom" : opts.type, range);
    const actual = actuals[m];
    const pct = target > 0 ? Math.round((actual / target) * 100) : (actual > 0 ? 100 : 0);
    snapshot[m] = { target, actual, pct };
  }
  return { range, snapshot };
}

/** その週の週次目標を kpi_targets から取る。レコードがなければ ITS デフォルト。 */
export async function getWeeklyTargets(opts: { ownerEmail: string | null; weekStart: Date }): Promise<Partial<Record<Metric, number>>> {
  const sb = engerAdmin();
  const ws = opts.weekStart.toISOString().slice(0, 10);
  const r: any = await sb.from("kpi_targets")
    .select("metric, target")
    .eq("week_start", ws)
    .eq("scope", opts.ownerEmail ? "person" : "team")
    .eq(opts.ownerEmail ? "owner_email" : "team_key", opts.ownerEmail ? opts.ownerEmail.toLowerCase() : "its");
  const got: Partial<Record<Metric, number>> = {};
  if (!r.error) for (const row of (r.data ?? [])) got[row.metric as Metric] = row.target;
  // ITS デフォルト（未設定指標のみ補填）
  const def: Partial<Record<Metric, number>> = { proposal: 20 };
  for (const m of METRIC_ORDER) if (got[m] == null && def[m] != null) got[m] = def[m];
  return got;
}

// #234①：ステージ目標ボード用の「チーム週次目標」（架電/打ち合わせ/案件の仕入れ/面談/合格）。
//   kpi_targets を scope='team' / team_key='stage' で共用（アクティビティの 'its' とは別枠）。
//   指標キーはステージ列キー（日本語・src/lib/stage-metrics）。未設定は空（表示側で per-member 合計にフォールバック）。
export async function getStageTeamWeekly(weekStart: Date): Promise<Record<string, number>> {
  const sb = engerAdmin();
  const ws = weekStart.toISOString().slice(0, 10);
  const r: any = await sb.from("kpi_targets")
    .select("metric, target")
    .eq("week_start", ws)
    .eq("scope", "team")
    .eq("team_key", "stage");
  const out: Record<string, number> = {};
  if (!r.error) for (const row of (r.data ?? [])) out[String(row.metric)] = Number(row.target) || 0;
  return out;
}

// ── 履歴テーブル（全指標 × 期間の実績/目標） ───────────────────────
export type KpiHistoryRow = {
  label: string;          // 期間ラベル（例: 6/9, 6/2〜, 2026/6）
  start: string;          // ISO（その期間の開始）
  cells: Record<Metric, { actual: number; target: number }>;
};

/** 直近 N 期間 × 全指標の実績/目標をまとめて返す（推移テーブル用）。
 *  proposals / kpi_targets を1往復ずつで取得し、JS側で期間バケットに振り分ける。
 *  cumulate: 実績・目標を累計（積み上げ）表示するときのリセット境界。
 *    - "month"   … 月初で累計リセット（日・週タブ）。各行は「その月の月初〜該当期間」の累計。
 *    - "quarter" … 四半期境界で累計リセット（四半期タブ）。各行＝その四半期の累計。
 *    - "all"     … リセットなし。表示範囲の開始から最後まで積み上げ（任意カレンダー）。
 *    - "off"     … 累計しない（各期間単体。月タブ等の従来表示）。 */
export async function getKpiHistoryTable(opts: {
  ownerName: string | null; ownerEmail: string | null;
  type: Exclude<PeriodType, "custom">; periods: number;
  cumulate?: "month" | "quarter" | "all" | "off";
}): Promise<KpiHistoryRow[]> {
  const ranges: { start: Date; end: Date; base: Date; weekStart: Date; label: string }[] = [];
  for (let i = opts.periods - 1; i >= 0; i--) {
    const base = shiftPeriod(new Date(), opts.type, -i);
    const range = resolveRange(opts.type, base);
    ranges.push({ ...range, base, weekStart: jstStartOfWeek(base), label: labelOfPeriod(opts.type, base) });
  }
  const overallStart = ranges[0].start;
  const overallEnd   = ranges[ranges.length - 1].end;

  const sb = engerAdmin();
  const startIso = overallStart.toISOString(), endIso = overallEnd.toISOString();

  let pq: any = await sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status, approval_status")
    .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso},updated_at.gte.${startIso}`)
    .limit(30000);
  if (pq.error && /approval_status|column/i.test(pq.error.message ?? "")) {
    pq = await sb.from("proposals")
      .select("id, proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status")
      .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso},updated_at.gte.${startIso}`)
      .limit(30000);
  }
  if (pq.error) pq = await sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at")
    .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso}`)
    .limit(30000);

  const tq: any = await sb.from("kpi_targets")
    .select("metric, target, week_start")
    .gte("week_start", overallStart.toISOString().slice(0, 10))
    .lt("week_start", overallEnd.toISOString().slice(0, 10))
    .eq("scope", opts.ownerEmail ? "person" : "team")
    .eq(opts.ownerEmail ? "owner_email" : "team_key", opts.ownerEmail ? opts.ownerEmail.toLowerCase() : "its");

  const props: any[] = pq.error ? [] : (pq.data ?? []);
  const targets: any[] = tq.error ? [] : (tq.data ?? []);

  // 提案は提案者(proposer)に計上（メンバー別アクティビティ表と同一基準）。
  const isProposer = (p: any) => !opts.ownerName || ownerMatches(opts.ownerName, p.proposer);
  const isCloser = (p: any) => !opts.ownerName || ownerMatches(opts.ownerName, p.closer);
  // 承認待ち / 差戻し は KPI(proposal) から除外。
  const isApproved = (p: any) => {
    const s = String(p?.approval_status ?? "").trim();
    return s !== "pending" && s !== "rejected";
  };
  const targetMap = new Map<string, Partial<Record<Metric, number>>>();
  for (const t of targets) {
    const k = String(t.week_start);
    if (!targetMap.has(k)) targetMap.set(k, {});
    targetMap.get(k)![t.metric as Metric] = t.target;
  }
  const def: Partial<Record<Metric, number>> = { proposal: 20 };

  // 各期間（行）の「単体」実績・目標をまず算出し、その後に累計（積み上げ）をかける。
  //   ・実績     … 期間内のイベント実数（提案/コンタクト/調整中/日程確定/成約）。
  //   ・目標     … 週次目標を表示単位に換算（scaleWeeklyTarget）。
  type RawRow = { label: string; start: string; rangeStart: Date; act: Record<Metric, number>; tgt: Record<Metric, number> };
  const raw: RawRow[] = [];
  for (const rng of ranges) {
    const sIso = rng.start.toISOString(), eIso = rng.end.toISOString();
    const inRange = (d: string | null) => !!d && d >= sIso && d < eIso;
    const act: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
    for (const p of props) {
      // 提案：スナップショット/メンバー別と同じ母数（提案中以降 or 見送り/失注・所属確認/承認待ちは除外）。
      if (isApproved(p) && metricFlags.isProposed(p) && isProposer(p) && inRange(p.created_at)) act.proposal++;
      if (!isCloser(p)) continue;
      const ev = p.stage_updated_at ?? p.updated_at ?? null;
      const evAny = p.updated_at ?? p.stage_updated_at ?? null;
      if (metricFlags.isContact(p)   && inRange(evAny)) act.contact++;
      if (metricFlags.isAdjusting(p) && inRange(evAny)) act.adjusting++;
      if (metricFlags.isSchedule(p)  && inRange(ev))    act.schedule++;
      if (metricFlags.isDeal(p)      && inRange(ev))    act.deal++;
    }
    const ws = rng.weekStart.toISOString().slice(0, 10);
    const w = targetMap.get(ws) ?? {};
    const tgt: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
    for (const m of METRIC_ORDER) tgt[m] = scaleWeeklyTarget(w[m] ?? def[m] ?? 0, opts.type, rng);
    raw.push({ label: rng.label, start: sIso, rangeStart: rng.start, act, tgt });
  }

  // 累計（積み上げ）。リセット境界が変わったら running をリセットして再スタート。
  //   ・"month"   → 月初リセット（日・週タブ：その月分のみ積み上げ）
  //   ・"quarter" → 四半期リセット（四半期タブ：その四半期内で積み上げ）
  //   ・"all"     → リセットなし（任意カレンダー：範囲全体を積み上げ）
  //   ・"off"     → 累計しない（各期間単体）
  const cumulate = opts.cumulate ?? (opts.type === "week" ? "month" : "off");
  const out: KpiHistoryRow[] = [];
  if (cumulate === "off") {
    for (const r of raw) {
      const cells = {} as Record<Metric, { actual: number; target: number }>;
      for (const m of METRIC_ORDER) cells[m] = { actual: r.act[m], target: r.tgt[m] };
      out.push({ label: r.label, start: r.start, cells });
    }
    return out;
  }
  const keyOf = (d: Date) => cumulateKeyOf(d, cumulate);
  let prevKey: string | null = null;
  let runAct: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
  let runTgt: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
  for (const r of raw) {
    const key = keyOf(r.rangeStart);
    if (prevKey !== null && key !== prevKey) {
      runAct = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
      runTgt = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
    }
    prevKey = key;
    const cells = {} as Record<Metric, { actual: number; target: number }>;
    for (const m of METRIC_ORDER) {
      runAct[m] += r.act[m];
      runTgt[m] += r.tgt[m];
      cells[m] = { actual: runAct[m], target: Math.round(runTgt[m]) };
    }
    out.push({ label: r.label, start: r.start, cells });
  }
  return out;
}

/**
 * 直近 N 期間の達成率推移（推移グラフ用）。
 * 期間ごとに別クエリすると 12 期間 × 数クエリで遅いため、全期間を含む 1 つのクエリで
 * まとめて取得し、JS側でバケットに振り分ける（DB往復: proposals×1 + meetings×1 + kpi_targets×1）。
 */
export async function getKpiHistory(opts: {
  ownerName: string | null; ownerEmail: string | null;
  type: Exclude<PeriodType, "custom">; periods: number;
  metric?: Metric;
  cumulate?: "month" | "quarter" | "all" | "off"; // 達成率を累計（積み上げ）で出すリセット境界
}): Promise<{ label: string; pct: number; actual: number; target: number }[]> {
  const metric: Metric = opts.metric ?? "proposal";

  // 1) 各期間の [start,end) を一気に作る
  const ranges: { start: Date; end: Date; base: Date; weekStart: Date; label: string }[] = [];
  for (let i = opts.periods - 1; i >= 0; i--) {
    const base = shiftPeriod(new Date(), opts.type, -i);
    const range = resolveRange(opts.type, base);
    ranges.push({ ...range, base, weekStart: jstStartOfWeek(base), label: labelOfPeriod(opts.type, base) });
  }
  const overallStart = ranges[0].start;
  const overallEnd   = ranges[ranges.length - 1].end;

  const sb = engerAdmin();
  const startIso = overallStart.toISOString();
  const endIso   = overallEnd.toISOString();

  // 2) proposals / kpi_targets を一括取得（全期間ぶん）。本人判定はJS側で寛容に。
  let pq: any = await sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status, approval_status")
    .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso},updated_at.gte.${startIso}`)
    .limit(30000);
  if (pq.error && /approval_status|column/i.test(pq.error.message ?? "")) {
    pq = await sb.from("proposals")
      .select("id, proposer, closer, stage, created_at, stage_updated_at, updated_at, caller_status, job_notify_status, cand_notify_status")
      .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso},updated_at.gte.${startIso}`)
      .limit(30000);
  }
  if (pq.error) pq = await sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at")
    .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso}`)
    .limit(30000);

  const tq: any = sb.from("kpi_targets")
    .select("metric, target, week_start, scope, owner_email, team_key")
    .gte("week_start", overallStart.toISOString().slice(0, 10))
    .lt("week_start", overallEnd.toISOString().slice(0, 10))
    .eq("scope", opts.ownerEmail ? "person" : "team")
    .eq(opts.ownerEmail ? "owner_email" : "team_key", opts.ownerEmail ? opts.ownerEmail.toLowerCase() : "its");

  const [pr, tr] = await Promise.all([Promise.resolve(pq), tq]);
  const props: any[]   = pr.error ? [] : (pr.data ?? []);
  const targets: any[] = tr.error ? [] : (tr.data ?? []);

  // 3) 期間バケットに振り分けて指標を集計
  // 提案は提案者(proposer)に計上（メンバー別アクティビティ表と同一基準）。
  const isProposer = (p: any) => !opts.ownerName || ownerMatches(opts.ownerName, p.proposer);
  const isCloser = (p: any) => !opts.ownerName || ownerMatches(opts.ownerName, p.closer);
  // 承認待ち / 差戻し は KPI(proposal) から除外。
  const isApproved = (p: any) => {
    const s = String(p?.approval_status ?? "").trim();
    return s !== "pending" && s !== "rejected";
  };
  const targetMap = new Map<string, Partial<Record<Metric, number>>>();
  for (const t of targets) {
    const k = String(t.week_start);
    if (!targetMap.has(k)) targetMap.set(k, {});
    targetMap.get(k)![t.metric as Metric] = t.target;
  }
  const def: Partial<Record<Metric, number>> = { proposal: 20 };

  // まず各期間の「単体」実績・目標を出し、その後に累計（積み上げ）をかける。
  type RawPt = { label: string; rangeStart: Date; act: number; tgt: number };
  const raw: RawPt[] = [];
  for (const rng of ranges) {
    const sIso = rng.start.toISOString(), eIso = rng.end.toISOString();
    const inRange = (d: string | null) => !!d && d >= sIso && d < eIso;

    let actual = 0;
    for (const p of props) {
      if (metric === "proposal") { if (isApproved(p) && metricFlags.isProposed(p) && isProposer(p) && inRange(p.created_at)) actual++; continue; }
      if (!isCloser(p)) continue;
      const ev = p.stage_updated_at ?? p.updated_at ?? null;
      const evAny = p.updated_at ?? p.stage_updated_at ?? null;
      if (metric === "contact"   && metricFlags.isContact(p)   && inRange(evAny)) actual++;
      else if (metric === "adjusting" && metricFlags.isAdjusting(p) && inRange(evAny)) actual++;
      else if (metric === "schedule"  && metricFlags.isSchedule(p)  && inRange(ev))    actual++;
      else if (metric === "deal"      && metricFlags.isDeal(p)      && inRange(ev))    actual++;
    }

    const ws = rng.weekStart.toISOString().slice(0, 10);
    const w = targetMap.get(ws) ?? {};
    const weekly = w[metric] ?? def[metric] ?? 0;
    const target = scaleWeeklyTarget(weekly, opts.type, rng);
    raw.push({ label: rng.label, rangeStart: rng.start, act: actual, tgt: target });
  }

  // 累計（積み上げ）。テーブルと同じリセット境界で実績・目標を積み上げ、pct を再計算する。
  //   "off"（既定）なら従来どおり各期間単体の達成率。
  const cumulate = opts.cumulate ?? "off";
  const mk = (act: number, tgt: number, label: string): { label: string; pct: number; actual: number; target: number } => {
    const t = Math.round(tgt);
    const pct = t > 0 ? Math.round((act / t) * 100) : (act > 0 ? 100 : 0);
    return { label, pct, actual: act, target: t };
  };
  if (cumulate === "off") return raw.map((r) => mk(r.act, r.tgt, r.label));
  const out: { label: string; pct: number; actual: number; target: number }[] = [];
  let prevKey: string | null = null;
  let runAct = 0, runTgt = 0;
  for (const r of raw) {
    const key = cumulateKeyOf(r.rangeStart, cumulate);
    if (prevKey !== null && key !== prevKey) { runAct = 0; runTgt = 0; }
    prevKey = key;
    runAct += r.act; runTgt += r.tgt;
    out.push(mk(runAct, runTgt, r.label));
  }
  return out;
}

function shiftPeriod(d: Date, type: Exclude<PeriodType, "custom">, n: number): Date {
  if (type === "day")     return addDays(jstStartOfDay(d), n);
  if (type === "week")    return addDays(jstStartOfWeek(d), n * 7);
  if (type === "month")   return addMonths(jstStartOfMonth(d), n);
  return addMonths(jstStartOfQuarter(d), n * 3);
}

function labelOfPeriod(type: Exclude<PeriodType, "custom">, d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MIN * 60 * 1000);
  const M = j.getUTCMonth() + 1, D = j.getUTCDate();
  if (type === "day")   return `${M}/${D}`;
  if (type === "week")  return `${M}/${D}〜`;
  if (type === "month") return `${j.getUTCFullYear()}/${M}`;
  return `${j.getUTCFullYear()}Q${Math.floor((M - 1) / 3) + 1}`;
}
