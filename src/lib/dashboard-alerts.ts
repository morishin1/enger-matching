// ダッシュボード「やらなければいけないこと（要対応）」アラート用。
//
// ■ 定義（お知らせとの切り分け）
//   「やらなければいけないこと」＝ 自分（または自部門）が“今アクションしないと案件が前に
//   進まない”、締切性のある未処理タスク。対応すると一覧から自然に消える（pending 件数を
//   直接見ているため、ログではない）。リンクは必ず「対応の入口」になっていること。
//   含めるもの（kind）:
//     - approval        … 自分宛の提案承認依頼（承認 → メール送信が必要）
//     - user_signup     … 新規ユーザー/LP登録の承認待ち
//     - company_job     … 企業の公開待ち案件など（公開・確認が必要）
//     - review_report   … 未確認の日報（確認・返信が必要）
//     - stale_proposal  … 滞留している提案（フォローが必要）
//     - lp_candidate    … LP登録エンジニア（面談打診が必要）
//     - followup        … 要フォロー
//     - respond_broken  … 回答リンク切れ等の不具合対応
//   ここに入れない（＝お知らせ側）: 単なる出来事の通知・周知・FYI（応募通知・日報返信・
//   周知・警告など。即アクション不要で「読めばよい」もの）は notifications を使う。

import { cache } from "react";
import { engerClient, engerAdmin, publicAdmin, dbConfigured } from "./supabase";
import { currentAccess } from "./accounts";
import { canManageDept } from "./roles";

export type DashboardAlert = {
  id: string;
  kind: "approval" | "user_signup" | "company_job" | "review_report" | "stale_proposal" | "lp_candidate" | "followup" | "respond_broken";
  severity: "high" | "med" | "low";
  title: string;
  body?: string | null;
  count?: number;
  href: string;
  cta: string;
};

const ACCESS_DENIED: DashboardAlert[] = [];

/** いま見えるべき「要対応」アイテムを集約。
 *   ・処理済みアイテムは自然に消える（pending 件数を直接見ているため再対応不要）。
 *   ・閲覧者の役割で出すアラートを絞る（admin/manager は承認系、メンバーは自分宛のみ）。 */
export const loadDashboardAlerts = cache(async (): Promise<DashboardAlert[]> => {
  if (!dbConfigured) return ACCESS_DENIED;
  const me = await currentAccess();
  if (!me) return ACCESS_DENIED;
  const isAdmin = me.role === "admin";
  const isManager = canManageDept(me.teamRole);
  // 社内メンバー（管理者・営業エージェント）。エンジニアのLP登録は社内全員に周知して面談につなげたい。
  const isInternal = me.role === "admin" || me.role === "agent";
  const myName = (me.name ?? "").trim();
  const myEmail = (me.email ?? "").trim();

  const sb = engerClient();
  const alerts: DashboardAlert[] = [];

  // ① ユーザー新規登録：app_users.status='pending' ＋ LP仮想エントリ（admin or 上長相当のみ）。
  //   承認導線の移設に合わせて宛先を分割：企業→企業管理の新着タブ／人材→マッチングの新着／
  //   エージェント→設定のユーザー管理。
  if (isAdmin || isManager) {
    try {
      const pend: any = await sb.from("app_users").select("role").eq("status", "pending");
      const realRows: any[] = pend.data ?? [];
      let lpRows: any[] = [];
      let entryRows: any[] = [];
      try {
        const { listLpPendingCandidates, listLpTalentEntries } = await import("./accounts");
        [lpRows, entryRows] = await Promise.all([listLpPendingCandidates(), listLpTalentEntries()]);
      } catch { /* LP集計が落ちても続行 */ }
      const all = [...realRows, ...lpRows];
      const isClientRole = (r: any) => r.role === "client" || r.role === "partner";
      const isAgentRole = (r: any) => r.role === "admin" || r.role === "agent";
      const clients = all.filter(isClientRole).length;
      const agents = all.filter(isAgentRole).length;
      // 人材＝app_users/profiles由来の非企業・非社内 ＋ LP登録エントリー（coo_talent_entries）。
      const talent = (all.length - clients - agents) + entryRows.length;
      if (clients > 0) alerts.push({
        id: "company_signup", kind: "user_signup", severity: "high",
        title: `企業の新規登録が ${clients} 件`,
        body: "エンジャービジネス経由の承認待ち",
        count: clients, href: "/companies?tab=new", cta: "企業管理 → 新着を開く",
      });
      if (talent > 0) alerts.push({
        id: "talent_signup", kind: "user_signup", severity: "high",
        title: `人材の新規登録が ${talent} 件`,
        body: "各LP（右腕COO・エンジャーフリーランス等）からの承認待ち",
        count: talent, href: "/newcomers", cta: "マッチング → 新着を開く",
      });
      if (agents > 0) alerts.push({
        id: "user_signup", kind: "user_signup", severity: "high",
        title: `エージェントの承認待ちが ${agents} 件`,
        count: agents, href: "/settings?tab=users", cta: "ユーザー管理を開く",
      });
    } catch { /* app_users 未整備は無視 */ }
  }

  // ② 提案の承認待ち（自分が approver の提案・あなた向けのみ）
  if (myName) {
    try {
      const ap = await sb.from("proposals").select("id", { count: "exact", head: true })
        .eq("approval_status", "pending").eq("stage", "承認待ち").ilike("approver", `%${myName}%`);
      const n = ap.count ?? 0;
      if (n > 0) alerts.push({
        id: "approval_proposals",
        kind: "approval",
        severity: "high",
        title: `あなたへの承認依頼 ${n} 件`,
        body: "提案管理で内容を確認し、承認のうえメールを送信してください。",
        count: n,
        href: "/proposals?tab=approval", // #342：承認待ちタブへ直接
        cta: "承認待ちを開く",
      });
    } catch { /* 承認列未整備は無視 */ }
  }

  // ③ 企業掲載の承認待ち（admin のみ）
  if (isAdmin) {
    try {
      const cj = await sb.from("jobs").select("job_no", { count: "exact", head: true })
        .eq("posted_by_client", true).eq("review_status", "pending");
      const n = cj.count ?? 0;
      if (n > 0) alerts.push({
        id: "client_jobs",
        kind: "company_job",
        severity: "med",
        title: `企業掲載の承認待ち ${n} 件`,
        body: "クライアントが投稿した案件の公開可否を判断してください。",
        count: n,
        href: "/jobs",
        cta: "案件一覧で確認",
      });
    } catch { /* posted_by_client 列未整備は無視 */ }
  }

  // ④ 部署メンバーの日報で未確認のもの（マネージャー/リーダー向け・admin はスキップ）
  if (!isAdmin && (isManager || me.teamRole === "manager" || me.teamRole === "leader") && me.department) {
    try {
      const adm = engerAdmin();
      const { data: deptUsers } = await adm.from("app_users").select("name").eq("department", me.department).not("name", "is", null);
      const names = Array.from(new Set((deptUsers ?? []).map((u: any) => u.name).filter(Boolean))) as string[];
      if (names.length > 0) {
        const rr = await sb.from("daily_reports").select("id", { count: "exact", head: true })
          .in("author", names).is("reviewed_by_manager_at", null);
        const n = rr.count ?? 0;
        if (n > 0) alerts.push({
          id: "review_reports",
          kind: "review_report",
          severity: "med",
          title: `部署メンバーの未確認日報 ${n} 件`,
          body: `${me.department} のメンバーの日報を確認してください（押すと相手に通知されます）。`,
          count: n,
          href: "/reports",
          cta: "日報を開く",
        });
      }
    } catch { /* daily_reports/列未整備は無視 */ }
  }

  // ⑤ 滞留している自分の提案（>=5日 進行中ステージで放置）。自分が提案者または承認者のもの。
  if (myName) {
    try {
      const since = new Date(Date.now() - 5 * 86400000).toISOString();
      const stale = await sb.from("proposals").select("id", { count: "exact", head: true })
        .not("stage", "in", '("見送り","失注","稼働","稼働決定","合格")')
        .lt("stage_updated_at", since)
        .or(`proposer.ilike.%${myName}%,closer.ilike.%${myName}%,approver.ilike.%${myName}%`);
      const n = stale.count ?? 0;
      if (n > 0) alerts.push({
        id: "stale_proposals",
        kind: "stale_proposal",
        severity: "low",
        title: `5日以上動きのない自分の提案 ${n} 件`,
        body: "次のアクションを記入するか、見送り/失注に整理しましょう。",
        count: n,
        href: "/proposals",
        cta: "提案管理で確認",
      });
    } catch { /* stage_updated_at 列未整備は無視 */ }
  }

  // ⑥ LPからのエンジニア新規登録（社内メンバー全員に周知＝面談につなげる）。
  //   要望：エンジニアが登録したらメンバー含め全員がわかるようにアラートを出し、面談できる動きに。
  //   admin だけでなく営業エージェントにも表示し、面談（/engineers の面談設定・実施）へ誘導する。
  if (isInternal) {
    try {
      const pub = publicAdmin();
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const ep: any = await pub.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", since)
        .or("github_id.not.is.null,display_name.not.is.null,role.eq.student");
      const n = ep.count ?? 0;
      if (n > 0) alerts.push({
        id: "lp_candidates",
        kind: "lp_candidate",
        severity: "med",
        title: `新しいエンジニアのLP登録 ${n} 件（直近14日）`,
        body: "内容を確認し、面談（面談設定・実施）を進めてください。担当が未対応なら声かけを。",
        count: n,
        href: "/engineers",
        cta: "エンジニアを確認・面談する",
      });
    } catch { /* public.profiles 未参照環境は無視 */ }
  }

  // ⑦ メール応答リンク切れの監視（過去24時間に /api/respond が invalid token / invalid request
  //    を返した件数）。admin のみ。0 件なら出さない。
  //    ログは notifications テーブルに recipient='_system' kind='respond_broken' で記録される。
  if (isAdmin) {
    try {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const br = await sb.from("notifications").select("id", { count: "exact", head: true })
        .eq("recipient", "_system").eq("kind", "respond_broken").gte("created_at", since);
      const n = br.count ?? 0;
      if (n > 0) alerts.push({
        id: "respond_broken",
        kind: "respond_broken",
        severity: "high",
        title: `メール応答リンク切れ ${n} 件（24時間）`,
        body: "受信者が「話を進める／見送り」を押せていません。提案管理から該当提案のメールを再送するか、開発担当に共有してください。",
        count: n,
        href: "/notifications?kind=respond_broken",
        cta: "詳細を確認",
      });
    } catch { /* notifications 未整備時は無視 */ }
  }

  // 並び：高 > 中 > 低、その中で件数が多い順。
  const order = { high: 0, med: 1, low: 2 } as const;
  alerts.sort((a, b) => order[a.severity] - order[b.severity] || (b.count ?? 0) - (a.count ?? 0));
  return alerts;
});
