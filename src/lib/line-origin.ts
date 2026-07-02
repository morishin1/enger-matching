// LINE 由来の案件/人材の ID 集合を取得する共通ヘルパ。
//   判定基準は /line タブと同一：
//     ・proposals.source = 'line' に紐づく job_id / candidate_id、または
//     ・jobs.signup_source = 'line' / candidates.signup_source = 'line'（新規登録で「LINE登録」した行）
//   いずれの列も未マイグレーション環境がありうるため fail-soft（取れなければ空集合）。
import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";

export type LineOriginIds = { jobIds: string[]; candidateIds: string[] };

export async function getLineOriginIds(): Promise<LineOriginIds> {
  const jobIds = new Set<string>();
  const candidateIds = new Set<string>();
  if (!dbConfigured) return { jobIds: [], candidateIds: [] };
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { try { sb = engerClient(); } catch { return { jobIds: [], candidateIds: [] }; } }

  // 1) proposals.source = 'line'
  try {
    const r: any = await sb.from("proposals").select("job_id, candidate_id").eq("source", "line").limit(5000);
    if (!r.error && Array.isArray(r.data)) for (const row of r.data) {
      if (row.job_id) jobIds.add(String(row.job_id));
      if (row.candidate_id) candidateIds.add(String(row.candidate_id));
    }
  } catch { /* source 列なし等は無視 */ }

  // 2) candidates.signup_source = 'line'（列が無い環境は fail-soft）
  try {
    const rc: any = await sb.from("candidates").select("id").eq("signup_source", "line").limit(5000);
    if (!rc.error && Array.isArray(rc.data)) for (const row of rc.data) if (row.id) candidateIds.add(String(row.id));
  } catch { /* signup_source 列なしは無視 */ }

  // 3) jobs.signup_source = 'line'
  try {
    const rj: any = await sb.from("jobs").select("id").eq("signup_source", "line").limit(5000);
    if (!rj.error && Array.isArray(rj.data)) for (const row of rj.data) if (row.id) jobIds.add(String(row.id));
  } catch { /* signup_source 列なしは無視 */ }

  return { jobIds: [...jobIds], candidateIds: [...candidateIds] };
}

/** ENGERフリーランス由来の人材ID集合（#260②）。
 *  ・freelance_candidate_links（E↔P 紐付け）＝「人材マスタへ新規登録」経由（確定的）
 *  ・candidates.signup_source が enger 系（LP登録の取り込み）
 *  いずれもテーブル/列が無い環境では fail-soft（空集合側に倒す）。 */
export async function getFreelanceCandidateIds(): Promise<string[]> {
  const ids = new Set<string>();
  if (!dbConfigured) return [];
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { try { sb = engerClient(); } catch { return []; } }
  try {
    const r: any = await sb.from("freelance_candidate_links").select("candidate_id").limit(5000);
    if (!r.error && Array.isArray(r.data)) for (const row of r.data) if (row.candidate_id) ids.add(String(row.candidate_id));
  } catch { /* リンクテーブル未整備は無視 */ }
  try {
    const r: any = await sb.from("candidates").select("id").in("signup_source", ["enger", "enger_lp", "engerjp"]).limit(5000);
    if (!r.error && Array.isArray(r.data)) for (const row of r.data) if (row.id) ids.add(String(row.id));
  } catch { /* signup_source 列なしは無視 */ }
  return [...ids];
}
