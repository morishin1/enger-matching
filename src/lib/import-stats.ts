import { engerClient, dbConfigured } from "./supabase";

export type ImportCounts = {
  available: boolean;
  today: { jobs: number; candidates: number };
  week: { jobs: number; candidates: number };
  total: { jobs: number; candidates: number };
};

const countSince = async (sb: any, table: string, idCol: string, dateCol: string, since?: string) => {
  let q = sb.from(table).select(idCol, { count: "exact", head: true });
  if (since) q = q.gte(dateCol, since);
  const { count, error } = await q;
  return error ? null : (count ?? 0);
};

/** CSV取込（imported_at）でDBに入った案件・人材の件数。今日／直近7日／累計。 */
export async function getImportCounts(): Promise<ImportCounts> {
  const empty: ImportCounts = { available: false, today: { jobs: 0, candidates: 0 }, week: { jobs: 0, candidates: 0 }, total: { jobs: 0, candidates: 0 } };
  if (!dbConfigured) return empty;
  try {
    const sb = engerClient();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

    // imported_at が無い環境は created_at にフォールバック
    let dateCol = "imported_at";
    const probe = await sb.from("jobs").select("job_no", { count: "exact", head: true }).gte("imported_at", weekAgo);
    if (probe.error) dateCol = "created_at";

    const [jToday, jWeek, jTotal, cToday, cWeek, cTotal] = await Promise.all([
      countSince(sb, "jobs", "job_no", dateCol, dayStart),
      countSince(sb, "jobs", "job_no", dateCol, weekAgo),
      countSince(sb, "jobs", "job_no", dateCol),
      countSince(sb, "candidates", "candidate_no", dateCol, dayStart),
      countSince(sb, "candidates", "candidate_no", dateCol, weekAgo),
      countSince(sb, "candidates", "candidate_no", dateCol),
    ]);
    if (jTotal == null && cTotal == null) return empty;
    return {
      available: true,
      today: { jobs: jToday ?? 0, candidates: cToday ?? 0 },
      week: { jobs: jWeek ?? 0, candidates: cWeek ?? 0 },
      total: { jobs: jTotal ?? 0, candidates: cTotal ?? 0 },
    };
  } catch { return empty; }
}
