import { unstable_cache } from "next/cache";
import { engerClient, publicAdmin, dbConfigured } from "./supabase";

export type SidebarCounts = Partial<Record<
  "jobs" | "people" | "companies" | "proposals" | "progress" | "matching" | "engineers" | "line"
  | "newJobs" | "newPeople" | "newEngineers" | "newLine" | "approvalsPending"
  | "proposalApprovals" /* 提案の承認待ち・差戻し件数（右上ベルの赤バッジ用・#235） */
  | "newClients" /* #419：新規登録の案件企業（法人・承認待ち）件数。サイドバー企業管理＋ベルの赤マーク用 */
  | "chatUnread" /* 担当の未読チャット有無（ドット表示用・0/1） */, number>>;

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

  // エンジャー登録数（ENGERフリーランス）。
  //   #345④：以前は profiles を粗い条件でCOUNTしており、一覧（listEngineers＝classifySource が
  //   "enger" のもの・退会処理済み除外）より大きい数字が出ていた。一覧と同じ取得・同じ判定で
  //   数えることで、タブの人数＝一覧に表示される人数に一致させる。
  const engineerCount = async (): Promise<number | undefined> => {
    try {
      const { listEngineers } = await import("./engineers");
      const { rows } = await listEngineers();
      return rows.filter((r: any) => !r.withdrawal_completed_at).length;
    } catch { return undefined; }
  };
  // 直近24時間の新着数（NEW マークの判定。マッチング配下タブ＋サイドバー）
  const since7 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const newEngineerCount = async (): Promise<number | undefined> => {
    try { const pub = publicAdmin(); const { count, error } = await pub.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since7).or("github_id.not.is.null,display_name.not.is.null,role.eq.student").or("signup_source.is.null,signup_source.not.in.(lms,mugen_dojo,dojo)"); return error ? undefined : (count ?? undefined); }
    catch { return undefined; }
  };
  // 承認待ち合算（app_users pending ＋ LP仮想エントリ）と、その内の「案件企業（法人）」数（#419）。
  //   listLpPendingCandidates（auth 列挙を含む重い処理）は1回だけ呼び、両方をまとめて算出する。
  const pendingBreakdown = async (): Promise<{ total?: number; clients?: number }> => {
    try {
      const real = await safeCount(() => sb.from("app_users").select("id", { count: "exact", head: true }).eq("status", "pending"));
      const realClients = await safeCount(() => sb.from("app_users").select("id", { count: "exact", head: true }).eq("status", "pending").in("role", ["client", "partner"]));
      const { listLpPendingCandidates } = await import("./accounts");
      const lp = await listLpPendingCandidates();
      const lpClients = lp.filter((a: any) => a.role === "client" || a.role === "partner").length;
      return { total: (real ?? 0) + lp.length, clients: (realClients ?? 0) + lpClients };
    } catch { return {}; }
  };

  // 提案の承認待ち・差戻し件数（右上ベルの赤バッジ用・#235）。
  //   ProposalsWorkspace の isAwaitingApproval と一致：approval_status in (pending,rejected) または stage=承認待ち。
  //   approval_status 列が無い旧スキーマでは stage=承認待ち のみで集計（エラーフォールバック）。
  const proposalApprovalsCount = async (): Promise<number | undefined> => {
    const withCol = await safeCount(() => sb.from("proposals").select("id", { count: "exact", head: true })
      .or("approval_status.in.(pending,rejected),stage.eq.承認待ち"));
    if (withCol !== undefined) return withCol;
    return safeCount(() => sb.from("proposals").select("id", { count: "exact", head: true }).eq("stage", "承認待ち"));
  };

  // LINE 経由案件・人材の合算件数。proposals.source='line' に紐づく案件/人材を distinct で集計。
  //   ・schema 未拡張環境では source 列が無いことがあるため、エラーは undefined として扱う。
  //   ・タブの数字としては「LINE 経由の案件 + LINE 経由の人材」のユニーク数。
  const lineCount = async (sinceIso?: string): Promise<number | undefined> => {
    try {
      let q: any = sb.from("proposals").select("job_id, candidate_id, created_at").eq("source", "line");
      if (sinceIso) q = q.gte("created_at", sinceIso);
      const r = await q;
      if (r.error || !Array.isArray(r.data)) return undefined;
      const set = new Set<string>();
      for (const row of r.data) {
        if (row.job_id) set.add(`j:${row.job_id}`);
        if (row.candidate_id) set.add(`c:${row.candidate_id}`);
      }
      return set.size;
    } catch { return undefined; }
  };

  const [jobs, people, companies, proposals, engagements, engineers, newJobs, newPeople, newEngineers, pendingBk, proposalApprovals, line, newLine] = await Promise.all([
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
    pendingBreakdown(),
    proposalApprovalsCount(),
    lineCount(),
    lineCount(since7),
  ]);
  return { jobs, people, companies, proposals, progress: engagements, engineers, newJobs, newPeople, newEngineers, approvalsPending: pendingBk.total, newClients: pendingBk.clients, proposalApprovals, line, newLine };
}

// 30秒キャッシュ + タグ。書き込み時に revalidateTag("sidebar-counts") で即時更新。
export const getSidebarCounts = unstable_cache(fetchCounts, ["sidebar-counts"], {
  revalidate: 30,
  tags: ["sidebar-counts"],
});
