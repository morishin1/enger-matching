import { engerAdmin, dbConfigured } from "./supabase";

export type Verdict = "want" | "maybe" | "mismatch";
export type Feedback = { proposal_id: string; verdict: Verdict; reason: string | null; company: string | null; updated_at: string };

export const VERDICT_LABEL: Record<Verdict, string> = { want: "会いたい", maybe: "検討中", mismatch: "ミスマッチ" };

/** 提案IDの配列に対する企業フィードバックを map で取得（サーバ専用）。 */
export async function getFeedbackMap(proposalIds: string[]): Promise<Record<string, Feedback>> {
  if (!dbConfigured || proposalIds.length === 0) return {};
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("client_feedback").select("proposal_id, verdict, reason, company, updated_at").in("proposal_id", proposalIds);
    if (error || !data) return {};
    const map: Record<string, Feedback> = {};
    for (const f of data as Feedback[]) map[f.proposal_id] = f;
    return map;
  } catch { return {}; }
}

/** 会社単位のフィードバック一覧（エージェント/管理者用）。 */
export async function listFeedbackByCompany(company: string): Promise<Feedback[]> {
  if (!dbConfigured || !company) return [];
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("client_feedback").select("proposal_id, verdict, reason, company, updated_at").ilike("company", `%${company}%`).order("updated_at", { ascending: false });
    if (error || !data) return [];
    return data as Feedback[];
  } catch { return []; }
}
