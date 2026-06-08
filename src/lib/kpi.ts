// KPI ダッシュボードの集計ロジック。
//   ・期間（日/週/月/四半期/任意）から開始日・終了日を作る
//   ・proposals / meetings から指標ごとの実績件数を集計
//   ・kpi_targets から目標値を取得し、期間に合わせて換算（週次が正、他は按分）
//
// JST 前提で week は月曜始まり、business days は月〜金で計算。

import { engerAdmin } from "./supabase";
import { ownerMatches } from "./owner-match";

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

  // 提案系: proposals を広めに取得し、本人判定はJS側で（略称↔フルネームに耐性）。
  const q: any = sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at, business_category")
    .or(`created_at.gte.${start},stage_updated_at.gte.${start}`)
    .limit(5000);
  const r = await q;
  const props: any[] = r.error ? [] : (r.data ?? []);

  const inRange = (d: string | null) => !!d && d >= start && d < end;
  const isOwner = (p: any) =>
    !opts.ownerName || ownerMatches(opts.ownerName, p.proposer) || ownerMatches(opts.ownerName, p.closer);

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

  // 打合せ: meetings.meeting_date が期間内（本人判定はJS側で寛容に）
  const mq: any = sb.from("meetings")
    .select("id, our_owner, meeting_date")
    .gte("meeting_date", start.slice(0, 10))
    .lt("meeting_date", end.slice(0, 10))
    .limit(5000);
  const mr = await mq;
  const meeting = mr.error ? 0 : (mr.data ?? []).filter((m: any) => !opts.ownerName || ownerMatches(opts.ownerName, m.our_owner)).length;

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

/**
 * 直近 N 期間の達成率推移（推移グラフ用）。
 * 期間ごとに別クエリすると 12 期間 × 数クエリで遅いため、全期間を含む 1 つのクエリで
 * まとめて取得し、JS側でバケットに振り分ける（DB往復: proposals×1 + meetings×1 + kpi_targets×1）。
 */
export async function getKpiHistory(opts: {
  ownerName: string | null; ownerEmail: string | null;
  type: Exclude<PeriodType, "custom">; periods: number;
  metric?: Metric;
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

  // 2) proposals / meetings / kpi_targets を一括取得（全期間ぶん）。本人判定はJS側で寛容に。
  const pq: any = sb.from("proposals")
    .select("id, proposer, closer, stage, created_at, stage_updated_at, business_category")
    .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso}`)
    .limit(20000);

  const mq: any = sb.from("meetings")
    .select("id, our_owner, meeting_date")
    .gte("meeting_date", startIso.slice(0, 10))
    .lt("meeting_date", endIso.slice(0, 10))
    .limit(20000);

  const tq: any = sb.from("kpi_targets")
    .select("metric, target, week_start, scope, owner_email, team_key")
    .gte("week_start", overallStart.toISOString().slice(0, 10))
    .lt("week_start", overallEnd.toISOString().slice(0, 10))
    .eq("scope", opts.ownerEmail ? "person" : "team")
    .eq(opts.ownerEmail ? "owner_email" : "team_key", opts.ownerEmail ? opts.ownerEmail.toLowerCase() : "its");

  const [pr, mr, tr] = await Promise.all([pq, mq, tq]);
  const props: any[]   = pr.error ? [] : (pr.data ?? []);
  const meets: any[]   = mr.error ? [] : (mr.data ?? []);
  const targets: any[] = tr.error ? [] : (tr.data ?? []);

  // 3) 期間バケットに振り分けて指標を集計
  const isOwner = (p: any) =>
    !opts.ownerName || ownerMatches(opts.ownerName, p.proposer) || ownerMatches(opts.ownerName, p.closer);
  const isMyMeeting = (m: any) => !opts.ownerName || ownerMatches(opts.ownerName, m.our_owner);
  const targetMap = new Map<string, Partial<Record<Metric, number>>>();
  for (const t of targets) {
    const k = String(t.week_start);
    if (!targetMap.has(k)) targetMap.set(k, {});
    targetMap.get(k)![t.metric as Metric] = t.target;
  }
  const def: Partial<Record<Metric, number>> = { proposal: 20, meeting: 3 };

  const out: { label: string; pct: number; actual: number; target: number }[] = [];
  for (const rng of ranges) {
    const sIso = rng.start.toISOString(), eIso = rng.end.toISOString();
    const inRange = (d: string | null) => !!d && d >= sIso && d < eIso;

    let actual = 0;
    for (const p of props) {
      if (!isOwner(p)) continue;
      if (metric === "proposal" && inRange(p.created_at)) actual++;
      else if (metric === "taku" && inRange(p.created_at) && p.business_category === "受託") actual++;
      else if (metric === "ec"   && inRange(p.created_at) && p.business_category === "EC")   actual++;
      else if (metric === "cl"   && inRange(p.stage_updated_at) && p.stage === "クロージング中") actual++;
      else if (metric === "won"  && inRange(p.stage_updated_at) && (p.stage === "稼働決定" || p.stage === "稼働")) actual++;
      else if (metric === "lost" && inRange(p.stage_updated_at) && p.stage === "失注") actual++;
    }
    if (metric === "meeting") {
      const sDate = sIso.slice(0, 10), eDate = eIso.slice(0, 10);
      for (const m of meets) if (isMyMeeting(m) && m.meeting_date >= sDate && m.meeting_date < eDate) actual++;
    }

    const ws = rng.weekStart.toISOString().slice(0, 10);
    const w = targetMap.get(ws) ?? {};
    const weekly = w[metric] ?? def[metric] ?? 0;
    const target = scaleWeeklyTarget(weekly, opts.type, rng);
    const pct = target > 0 ? Math.round((actual / target) * 100) : (actual > 0 ? 100 : 0);
    out.push({ label: rng.label, pct, actual, target });
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
