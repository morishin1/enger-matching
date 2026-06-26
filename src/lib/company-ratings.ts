// ============================================================
// 企業評価（★）：失注時に付けた案件★(job_rating) を企業ごとに平均して算出。
//   提案の company（案件側企業名）でグルーピングし、案件★の平均を企業の評価とする。
//   job_rating 列が無い環境（未マイグレ）では空を返す（fail-soft）。
// ============================================================
import { engerClient, dbConfigured } from "./supabase";

export type CompanyRating = { avg: number; count: number };

/** 企業名 → {avg, count}。案件★(job_rating 1-5)の平均。 */
export async function getCompanyRatings(): Promise<Record<string, CompanyRating>> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const { data, error } = await sb
      .from("proposals")
      .select("company, job_rating")
      .not("job_rating", "is", null)
      .limit(20000);
    if (error) return {};
    const acc: Record<string, { sum: number; n: number }> = {};
    for (const r of (data ?? []) as any[]) {
      const name = String(r.company ?? "").trim();
      const rating = Number(r.job_rating);
      if (!name || !(rating >= 1 && rating <= 5)) continue;
      (acc[name] ??= { sum: 0, n: 0 });
      acc[name].sum += rating;
      acc[name].n += 1;
    }
    const out: Record<string, CompanyRating> = {};
    for (const [name, v] of Object.entries(acc)) {
      out[name] = { avg: Math.round((v.sum / v.n) * 10) / 10, count: v.n };
    }
    return out;
  } catch {
    return {};
  }
}
