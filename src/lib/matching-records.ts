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
  // #470：提案日＋案件先/人材先の応答（話を進める=緑/見送り=赤/未回答）を詳細ページにも表示する。
  proposed_at?: string | null;
  job_action_type?: string | null;
  cand_action_type?: string | null;
};

const COLS = "id, job_id, candidate_id, job_title, candidate_name, stage, progress_status, proposed_at, job_action_type, cand_action_type, created_at";
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
  const rows = r.data as MatchingRecord[];

  // #383：案件名・人材名は提案記録に保存されたスナップショットだが、案件詳細/人材詳細で
  //   タイトル・氏名が編集されたら「現在値」に追随させる（存在する案件/人材の最新名で上書き）。
  try {
    const jobIds = Array.from(new Set(rows.map((x) => x.job_id).filter(Boolean))) as string[];
    const candIds = Array.from(new Set(rows.map((x) => x.candidate_id).filter(Boolean))) as string[];
    const [jt, cn] = await Promise.all([
      jobIds.length ? sb.from("jobs").select("id, title").in("id", jobIds).limit(500).then((x: any) => x.error ? [] : (x.data ?? [])) : Promise.resolve([]),
      candIds.length ? sb.from("candidates").select("id, name").in("id", candIds).limit(500).then((x: any) => x.error ? [] : (x.data ?? [])) : Promise.resolve([]),
    ]);
    const titleById = new Map<string, string>();
    for (const j of jt as any[]) { const t = String(j?.title ?? "").trim(); if (j?.id && t) titleById.set(String(j.id), t); }
    const nameById = new Map<string, string>();
    for (const c of cn as any[]) { const n = String(c?.name ?? "").trim(); if (c?.id && n) nameById.set(String(c.id), n); }
    for (const x of rows) {
      if (x.job_id && titleById.has(x.job_id)) x.job_title = titleById.get(x.job_id)!;
      if (x.candidate_id && nameById.has(x.candidate_id)) x.candidate_name = nameById.get(x.candidate_id)!;
    }
  } catch { /* 現在値解決に失敗してもスナップショットで表示は継続 */ }

  return rows;
}

/** 終了系（見送り/失注）ステージかどうか。表示バッジの出し分けに使う。 */
export function isLostStage(stage: string | null | undefined): boolean {
  const v = String(stage ?? "").trim();
  return v === "見送り" || v === "失注";
}
