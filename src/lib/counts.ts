import { unstable_cache } from "next/cache";
import { engerClient, publicAdmin, dbConfigured } from "./supabase";

export type SidebarCounts = Partial<Record<
  "jobs" | "people" | "companies" | "proposals" | "progress" | "matching" | "engineers"
  | "newJobs" | "newPeople" | "newEngineers" | "approvalsPending", number>>;

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

  // エンジャー登録数（profiles＝LP/GitHub登録）。public スキーマのため service role で集計。
  const engineerCount = async (): Promise<number | undefined> => {
    try { const pub = publicAdmin(); const { count, error } = await pub.from("profiles").select("id", { count: "exact", head: true }).or("github_id.not.is.null,display_name.not.is.null,role.eq.student"); return error ? undefined : (count ?? undefined); }
    catch { return undefined; }
  };
  // 直近7日の新着数（マッチング配下タブのバッジ）
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const newEngineerCount = async (): Promise<number | undefined> => {
    try { const pub = publicAdmin(); const { count, error } = await pub.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since7).or("github_id.not.is.null,display_name.not.is.null,role.eq.student"); return error ? undefined : (count ?? undefined); }
    catch { return undefined; }
  };
  // 承認待ち合算（app_users pending ＋ LP仮想エントリ）
  const approvalsPendingCount = async (): Promise<number | undefined> => {
    try {
      const real = await safeCount(() => sb.from("app_users").select("id", { count: "exact", head: true }).eq("status", "pending"));
      const { listLpPendingCandidates } = await import("./accounts");
      const lp = await listLpPendingCandidates();
      return (real ?? 0) + lp.length;
    } catch { return undefined; }
  };

  const [jobs, people, companies, proposals, engagements, engineers, newJobs, newPeople, newEngineers, approvalsPending] = await Promise.all([
    safeCount(() => sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true)),
    safeCount(() => sb.from("candidates").select("id", { count: "exact", head: true })),
    companyCount(),
    safeCount(() => sb.from("proposals").select("id", { count: "exact", head: true }).not("stage", "in", '("見送り","失注")')),
    safeCount(() => sb.from("engagements").select("id", { count: "exact", head: true })),
    engineerCount(),
    safeCount(() => sb.from("jobs").select("id", { count: "exact", head: true }).eq("is_published", true).gte("created_at", since7)),
    safeCount(() => sb.from("candidates").select("id", { count: "exact", head: true }).gte("created_at", since7)),
    newEngineerCount(),
    // 承認待ち件数（サイドメニューの NEW バッジ用）。
    //   app_users(status=pending) ＋ LP仮想エントリ(profiles/auth.users で app_users 未登録) の合算。
    //   サーバ集計は listLpPendingCandidates を内部で呼んで件数化する。
    approvalsPendingCount(),
  ]);
  return { jobs, people, companies, proposals, progress: engagements, engineers, newJobs, newPeople, newEngineers, approvalsPending };
}

// 30秒キャッシュ + タグ。書き込み時に revalidateTag("sidebar-counts") で即時更新。
export const getSidebarCounts = unstable_cache(fetchCounts, ["sidebar-counts"], {
  revalidate: 30,
  tags: ["sidebar-counts"],
});
