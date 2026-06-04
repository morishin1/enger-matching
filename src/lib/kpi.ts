// KPI ダッシュボードの集計ロジック。
//   ・期間（日/週/月/四半期/任意）から開始日・終了日を作る
//   ・proposals / meetings から指標ごとの実績件数を集計
//   ・kpi_targets から目標値を取得し、期間に合わせて換算（週次が正、他は按分）
//
// JST 前提で week は月曜始まり、business days は月〜金で計算。

import { engerAdmin } from "./supabase";

export type PeriodType = "day" | "week" | "month" | "quarter" | "custom";

export type Metric = "proposal" | "cl" | "won" | "lost" | "taku" | "ec" | "meeting";

export const METRIC_LABELS: Record<Metric, { short: string; long: string; tone: string }> = {
  proposal: { short: "提案",   long: "新規提案",     tone: "#0095D9" },
  cl:       { short: "CL",     long: "クロージング", tone: "#7c3aed" },
  won:      { short: "○",      long: "受注",         tone: "#067647" },
  lost:     { short: "×",      long: "失注",         tone: "#b42318" },
  taku:     { short: "PC",     long: "受託",         tone: "#0e7490" },
  ec:       { short: "N",      long: "EC",           tone: "#b45309" },
  meeting:  { short: "打合せ", long: "打合せ",       tone: "#475569" },
};

export const METRIC_ORDER: Metric[] = ["proposal", "cl", "won", "lost", "taku", "ec", "meeting"];

// ── 期間ヘルパ ────────────────────────────────────────────────────────
const JST_OFFSET_MIN = 9 * 60;

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
}): Promise<{ range: { start: Date; end: Date }; snapshot: KpiSnapshot }> {
  const range = resolveRange(opts.type, opts.base, opts.custom);
  const sb = engerAdmin();
  const start = iso(range.start), end = iso(range.end);

  // 提案系: proposals テーブルから取得（多くても1000件想定で十分）
  let q: any = sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at, business_category")
    .or(`created_at.gte.${start},stage_updated_at.gte.${start}`)
    .limit(5000);
  if (opts.ownerName) q = q.or(`proposer.eq.${opts.ownerName},closer.eq.${opts.ownerName}`);
  const r = await q;
  const props: any[] = r.error ? [] : (r.data ?? []);

  const inRange = (d: string | null) => !!d && d >= start && d < end;
  const isOwner = (p: any) =>
    !opts.ownerName || p.proposer === opts.ownerName || p.closer === opts.ownerName;

  let proposal = 0, cl = 0, won = 0, lost = 0, taku = 0, ec = 0;
  for (const p of props) {
    if (!isOwner(p)) continue;
    if (inRange(p.created_at)) {
      proposal++;
      if (p.business_category === "受託") taku++;
      else if (p.business_category === "EC") ec++;
    }
    if (inRange(p.stage_updated_at)) {
      if (p.stage === "クロージング中") cl++;
      else if (p.stage === "稼働決定" || p.stage === "稼働") won++;
      else if (p.stage === "失注") lost++;
    }
  }

  // 打合せ: meetings.meeting_date が期間内
  let mq: any = sb.from("meetings")
    .select("id, our_owner, meeting_date")
    .gte("meeting_date", start.slice(0, 10))
    .lt("meeting_date", end.slice(0, 10))
    .limit(5000);
  if (opts.ownerName) mq = mq.eq("our_owner", opts.ownerName);
  const mr = await mq;
  const meeting = mr.error ? 0 : (mr.data?.length ?? 0);

  const actuals: Record<Metric, number> = { proposal, cl, won, lost, taku, ec, meeting };
  const w = opts.weeklyTargets ?? {};
  const snapshot = {} as KpiSnapshot;
  for (const m of METRIC_ORDER) {
    const target = scaleWeeklyTarget(w[m] ?? 0, opts.type, range);
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
  const def: Partial<Record<Metric, number>> = { proposal: 20, meeting: 3 };
  for (const m of METRIC_ORDER) if (got[m] == null && def[m] != null) got[m] = def[m];
  return got;
}

/** 直近 N 期間の達成率推移（推移グラフ用）。 */
export async function getKpiHistory(opts: {
  ownerName: string | null; ownerEmail: string | null;
  type: Exclude<PeriodType, "custom">; periods: number;
  metric?: Metric; // 指定がなければ提案を使う
}): Promise<{ label: string; pct: number; actual: number; target: number }[]> {
  const out: { label: string; pct: number; actual: number; target: number }[] = [];
  const metric: Metric = opts.metric ?? "proposal";
  for (let i = opts.periods - 1; i >= 0; i--) {
    const base = shiftPeriod(new Date(), opts.type, -i);
    const ws = jstStartOfWeek(base);
    const w = await getWeeklyTargets({ ownerEmail: opts.ownerEmail, weekStart: ws });
    const snap = await getKpiSnapshot({ ownerName: opts.ownerName, type: opts.type, base, weeklyTargets: w });
    const m = snap.snapshot[metric];
    out.push({ label: labelOfPeriod(opts.type, base), pct: m.pct, actual: m.actual, target: m.target });
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
