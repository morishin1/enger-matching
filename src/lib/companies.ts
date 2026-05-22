import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

export type CompanyRow = {
  name: string;
  job_count: number;
  active_jobs: number;
  focus_jobs: number;
  last_job_at: string | null;
  avg_rate: number | null;
  tier: "A" | "B" | "C";
  status: string;
  proposals_total: number;
  won: number;
  lost: number;
  last_sentiment: string | null;
  last_relation: string | null;
  last_meeting_at: string | null;
  meeting_count: number;
};

/**
 * 「どの企業を狙うべきか」のスコア(0-100)。
 * 案件供給力 + 注力 + 稼働実績 + 打合せ温度感 + 関係性 + 鮮度 − 失注。
 */
export function targetScore(c: CompanyRow): { score: number; reasons: string[] } {
  let s = 0;
  const reasons: string[] = [];
  s += Math.min(c.active_jobs ?? 0, 10) * 4;
  if ((c.active_jobs ?? 0) >= 5) reasons.push(`募集中${c.active_jobs}件`);
  s += Math.min(c.focus_jobs ?? 0, 5) * 2;
  s += Math.min(c.won ?? 0, 5) * 4;
  if ((c.won ?? 0) > 0) reasons.push(`稼働実績${c.won}件`);

  const sent = c.last_sentiment ?? "";
  if (sent.includes("ポジ")) { s += 15; reasons.push("反応ポジティブ"); }
  else if (sent.includes("競合")) { s += 5; reasons.push("競合検討中"); }
  else if (sent.includes("ネガ")) { s -= 10; reasons.push("反応ネガティブ"); }

  const rel = c.last_relation ?? "";
  if (rel.includes("継続") || rel.includes("再構築")) { s += 10; reasons.push("関係構築中"); }
  else if (rel.includes("新規")) { s += 5; }
  else if (rel.includes("休眠")) { s -= 10; }

  const days = c.last_job_at ? (Date.now() - new Date(c.last_job_at).getTime()) / 86400000 : 999;
  if (days <= 30) { s += 10; reasons.push("直近で案件あり"); }
  else if (days <= 90) { s += 5; }
  else { s -= 5; reasons.push("案件が停滞"); }

  s -= Math.min(c.lost ?? 0, 5) * 2;
  if ((c.lost ?? 0) >= 3) reasons.push(`失注${c.lost}件`);

  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons.slice(0, 3) };
}

async function fetchCompanies(): Promise<CompanyRow[] | null> {
  if (!dbConfigured) return null;
  try {
    const sb = engerClient();
    const { data, error } = await sb.rpc("company_overview");
    if (error || !data) return null;
    return data as CompanyRow[];
  } catch {
    return null;
  }
}

// 案件集計は重いので 5 分キャッシュ
export const getCompanyOverview = unstable_cache(fetchCompanies, ["company-overview"], { revalidate: 300 });
