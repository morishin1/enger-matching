import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

export type SidebarCounts = Partial<Record<"jobs" | "people" | "companies" | "proposals" | "progress" | "matching", number>>;

async function fetchCounts(): Promise<SidebarCounts> {
  if (!dbConfigured) return {};
  try {
    const sb = engerClient();
    const head = (q: any) => q; // alias
    const [jobs, people, companies, proposals, focusJobs] = await Promise.all([
      sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true),
      sb.from("candidates").select("id", { count: "exact", head: true }),
      sb.from("companies").select("id", { count: "exact", head: true }),
      sb.from("proposals").select("id", { count: "exact", head: true }),
      sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_focus", true),
    ]);
    void head;
    return {
      jobs: jobs.count ?? undefined,
      people: people.count ?? undefined,
      companies: companies.count ?? undefined,
      proposals: proposals.count ?? undefined,
      progress: proposals.count ?? undefined,
      matching: focusJobs.count ?? undefined,
    };
  } catch {
    return {};
  }
}

// 60秒キャッシュ（毎ページの問い合わせを避けて高速化）
export const getSidebarCounts = unstable_cache(fetchCounts, ["sidebar-counts"], { revalidate: 60 });
