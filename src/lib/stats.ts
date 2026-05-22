import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

export type MatchingStats = {
  jobs_total: number;
  jobs_proposable: number;
  jobs_new7: number;
  jobs_detail_full: number;
  cand_total: number;
  cand_proposable: number;
  cand_skills: number;
  cand_profile_full: number;
  cand_stale: number;
  cand_dupes: number;
};

async function fetchStats(): Promise<MatchingStats | null> {
  if (!dbConfigured) return null;
  try {
    const sb = engerClient();
    const { data, error } = await sb.rpc("matching_stats");
    if (error || !data) return null;
    return data as MatchingStats;
  } catch {
    return null;
  }
}

// 集計は重いので 5 分キャッシュ（案件/人材ページで共有）。
export const getMatchingStats = unstable_cache(fetchStats, ["matching-stats"], { revalidate: 300 });

export const pct = (num?: number, den?: number) =>
  den && den > 0 ? Math.round(((num ?? 0) / den) * 100) : 0;
