import { engerClient, dbConfigured } from "./supabase";

export type Actuals = { proposalsToday: number; activeProps: number; meetingsToday: number; meetingsWeek: number };
export type DailyReport = {
  id: string; author: string; report_date: string; did: string[];
  self_check: Record<string, string> | null; good: string | null; problem: string | null; cause: string | null;
  next_action: string | null; mood: string | null; outputs: number | null; contacts: number | null;
  metrics: any; ai_comment: string | null;
};

const ACTIVE = ["返信待ち", "提案中", "面談調整", "クロージング中", "面談合格"];
const todayStr = () => new Date().toISOString().slice(0, 10);
const weekAgoStr = () => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

/** 本人の当日実績を自動集計（入力不要・事実を提示）。 */
export async function getActuals(name: string | null): Promise<Actuals> {
  const empty = { proposalsToday: 0, activeProps: 0, meetingsToday: 0, meetingsWeek: 0 };
  if (!name || !dbConfigured) return empty;
  try {
    const sb = engerClient();
    const today = todayStr();
    const [pr, mr] = await Promise.all([
      sb.from("proposals").select("stage, proposer, created_at").or(`proposer.eq.${name}`).limit(1000),
      sb.from("meetings").select("our_owner, meeting_date").eq("our_owner", name).limit(1000),
    ]);
    const props = (pr.data ?? []) as any[];
    const meets = (mr.data ?? []) as any[];
    return {
      proposalsToday: props.filter((p) => String(p.created_at ?? "").slice(0, 10) === today).length,
      activeProps: props.filter((p) => ACTIVE.includes(p.stage)).length,
      meetingsToday: meets.filter((m) => String(m.meeting_date ?? "").slice(0, 10) === today).length,
      meetingsWeek: meets.filter((m) => String(m.meeting_date ?? "").slice(0, 10) >= weekAgoStr()).length,
    };
  } catch { return empty; }
}

export type ReportIssue = { author: string; date: string; problem: string; cause: string | null; next_action: string | null; mood: string | null };

/** 直近の日報から「課題（problem）あり / 不調」を抽出してアラート用に返す。 */
export async function getReportIssues(days = 2): Promise<ReportIssue[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerClient();
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const { data, error } = await sb.from("daily_reports")
      .select("author, report_date, problem, cause, next_action, mood")
      .gte("report_date", since).order("report_date", { ascending: false }).limit(100);
    if (error || !data) return [];
    return (data as any[])
      .filter((r) => (r.problem && String(r.problem).trim()) || /不調|しんどい|悪|😟|😞|😣|⚠/.test(String(r.mood ?? "")))
      .map((r) => ({ author: r.author, date: r.report_date, problem: String(r.problem ?? "").trim(), cause: r.cause ?? null, next_action: r.next_action ?? null, mood: r.mood ?? null }));
  } catch { return []; }
}

/** 日報一覧（新しい順）。 */
export async function listReports(opts?: { author?: string; limit?: number }): Promise<DailyReport[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerClient();
    let q = sb.from("daily_reports").select("*").order("report_date", { ascending: false }).limit(opts?.limit ?? 60);
    if (opts?.author) q = q.eq("author", opts.author);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as DailyReport[];
  } catch { return []; }
}
