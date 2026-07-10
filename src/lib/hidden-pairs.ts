// #345①②：「このペアは表示させない」ペア（job_no×candidate_no）の読み取り共通ヘルパ。
//   おすすめTOP50／ランキング100（ranking100.ts）だけでなく、個別マッチング
//   （人材→案件TOP10・案件→人材TOP10＝matching/page.tsx）でも同じ集合で除外する。
//   読み取りは service role（engerAdmin）を優先：anon の grant 未適用環境でも
//   権限エラーで「空集合＝非表示が効かない」事故を起こさないため。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export const hiddenPairKey = (jobNo: number | null | undefined, candNo: number | null | undefined) => `${jobNo}|${candNo}`;

/** 非表示ペアの集合（"job_no|candidate_no"）。テーブル未整備・権限エラー時は空集合（fail-soft）。 */
export async function getHiddenPairsSet(): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (!dbConfigured) return hidden;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data } = await sb.from("hidden_pairs").select("job_no, candidate_no").limit(50000);
    for (const p of (data ?? []) as any[]) {
      if (p.job_no != null && p.candidate_no != null) hidden.add(hiddenPairKey(p.job_no, p.candidate_no));
    }
  } catch { /* hidden_pairs 未整備でも続行 */ }
  return hidden;
}
