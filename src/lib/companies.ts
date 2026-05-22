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
};

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
