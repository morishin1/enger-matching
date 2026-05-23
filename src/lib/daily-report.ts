import { engerClient, dbConfigured } from "./supabase";

export type Actuals = { proposalsToday: number; activeProps: number; meetingsToday: number; meetingsWeek: number };
export type DailyReport = {
  id: string; author: string; report_date: string; did: string[]; did_note: string | null;
  learned: string | null; next_action: string | null; mood: string | null; metrics: any; ai_comment: string | null;
};

const ACTIVE = ["未対応", "提案中", "面談調整", "クロージング中", "面談合格"];
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
