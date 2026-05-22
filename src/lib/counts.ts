import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";

export type SidebarCounts = Partial<Record<"jobs" | "people" | "companies" | "proposals" | "progress" | "matching", number>>;

async function fetchCounts(): Promise<SidebarCounts> {
  if (!dbConfigured) return {};
  const sb = engerClient();
  // テーブル未作成でも他のカウントが消えないよう個別に安全集計
  const safeCount = async (build: () => any): Promise<number | undefined> => {
    try { const r = await build(); return r.error ? undefined : (r.count ?? undefined); }
    catch { return undefined; }
  };
  // 企業数は案件のクライアント名から集約(company_overview)した実数。無ければ companies テーブル。
  const companyCount = async (): Promise<number | undefined> => {
    try {
      const r = await sb.rpc("company_overview");
      if (!r.error && Array.isArray(r.data)) return r.data.length;
    } catch { /* noop */ }
    return safeCount(() => sb.from("companies").select("id", { count: "exact", head: true }));
  };

  const [jobs, people, companies, proposals, engagements, matching] = await Promise.all([
    safeCount(() => sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true)),
    safeCount(() => sb.from("candidates").select("id", { count: "exact", head: true })),
    companyCount(),
    safeCount(() => sb.from("proposals").select("id", { count: "exact", head: true }).not("stage", "in", '("見送り","失注")')),
    safeCount(() => sb.from("engagements").select("id", { count: "exact", head: true })),
    safeCount(() => sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_focus", true)),
  ]);
  return { jobs, people, companies, proposals, progress: engagements, matching };
}

// 30秒キャッシュ + タグ。書き込み時に revalidateTag("sidebar-counts") で即時更新。
export const getSidebarCounts = unstable_cache(fetchCounts, ["sidebar-counts"], {
  revalidate: 30,
  tags: ["sidebar-counts"],
});
