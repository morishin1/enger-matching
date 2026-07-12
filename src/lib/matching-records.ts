// #333：案件詳細・人材詳細に「提案ボードに記録済みのマッチングレコード」を一覧表示するための取得。
//   対象（candidate_id / job_id）が合致する proposals を、リンク付きで一行ずつ表示する。
//   ・見送り（失注）に移動したレコードもそのまま一覧に残す（stage で除外しない）。
//   ・削除された（物理DELETE）レコードは行自体が無いので自然に消える（ソフト削除列は無い）。

export type MatchingRecord = {
  id: string;
  job_id: string | null;
  candidate_id: string | null;
  job_title: string | null;
  candidate_name: string | null;
  stage: string | null;
  progress_status: string | null;
  created_at: string | null;
};

const COLS = "id, job_id, candidate_id, job_title, candidate_name, stage, progress_status, created_at";
const COLS_FALLBACK = "id, job_id, candidate_id, job_title, candidate_name, stage, created_at";

/** candidate_id または job_id に紐づくマッチングレコードを新しい順で返す。
 *   どちらのキーで引くかは引数で指定（両方指定時は candidateId を優先）。 */
export async function getMatchingRecordsFor(
  sb: any,
  key: { candidateId?: string | null; jobId?: string | null },
): Promise<MatchingRecord[]> {
  const col = key.candidateId ? "candidate_id" : key.jobId ? "job_id" : null;
  const val = key.candidateId ?? key.jobId ?? null;
  if (!sb || !col || !val) return [];
  const run = (cols: string) => sb.from("proposals").select(cols).eq(col, val).order("created_at", { ascending: false }).limit(200);
  let r: any = await run(COLS);
  // progress_status 未整備の環境ではフォールバック（#334 の列が無くても一覧は出す）。
  if (r.error && /progress_status|column/i.test(r.error.message ?? "")) r = await run(COLS_FALLBACK);
  if (r.error || !Array.isArray(r.data)) return [];
  return r.data as MatchingRecord[];
}

/** 終了系（見送り/失注）ステージかどうか。表示バッジの出し分けに使う。 */
export function isLostStage(stage: string | null | undefined): boolean {
  const v = String(stage ?? "").trim();
  return v === "見送り" || v === "失注";
}
