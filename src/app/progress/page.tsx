import { Workbench } from "@/components/Workbench";
import { FlowSteps } from "@/components/FlowSteps";
import { ProgressTabs } from "@/components/ProgressTabs";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { maskEngagement } from "@/lib/engagement-access";
import { currentPeriod } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ period?: string; engagement?: string }> }) {
  const { period: pRaw, engagement: engagementId } = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(pRaw ?? "") ? (pRaw as string) : currentPeriod();
  const highlightEngagementId = (engagementId && /^[0-9a-f-]{8,}$/i.test(engagementId)) ? engagementId : null;

  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;
  let boardLastSynced: string | null = null;

  const access = await currentAccess();
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  // 表示スコープ：admin（経営/管理）のみ全件、それ以外（マネージャー含む agent）は自分担当のみ。
  //   ※ バックオフィス職能を持っていても表示は自分担当のみに統一。請求書/勤怠の編集権限(canManage)とは別。
  const agentScoped = role !== "admin";

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, proposal_id, job_title, company, candidate_name, monthly_rate, start_date, end_date, status, created_at";
      const rich = `${base}, cost, affiliation, settle_min, settle_max, work_hours, contract_status, po_status, renewal_due, renewal_status, board_project_id`;
      let res: any = await sb.from("engagements").select(rich).order("created_at", { ascending: false }).limit(300);
      if (res.error) res = await sb.from("engagements").select(base).order("created_at", { ascending: false }).limit(300);
      if (res.error) needSetup = true;
      else rows = res.data ?? [];

      // エージェント（バックオフィス専任を除く）は「自分が担当している人材」のみ表示。
      if (agentScoped && access?.name && rows.length > 0) {
        const me = access.name;
        const pr = await sb.from("proposals").select("id, candidate_name").or(`proposer.eq.${me},partner.eq.${me},closer.eq.${me}`).limit(2000);
        const myProposalIds = new Set((pr.data ?? []).map((p: any) => p.id));
        const myCandidates = new Set((pr.data ?? []).map((p: any) => p.candidate_name).filter(Boolean));
        rows = rows.filter((e) => myProposalIds.has(e.proposal_id) || (e.candidate_name && myCandidates.has(e.candidate_name)));
      }

      // 当月の勤怠・請求（billing_tasks）をマージ
      if (rows.length > 0) {
        const ids = rows.map((e) => e.id);
        const bt = await sb.from("billing_tasks").select("engagement_id, attendance_status, attendance_hours, attendance_file, invoice_status, invoice_amount, invoice_file").eq("period", period).in("engagement_id", ids);
        if (!bt.error) {
          const byEng = new Map((bt.data ?? []).map((b: any) => [b.engagement_id, b]));
          rows = rows.map((e) => ({ ...e, bill: byEng.get(e.id) ?? null }));
        }
      }

      // board 同期の最終実行時刻（app_settings）
      try {
        const s = await sb.from("app_settings").select("value").eq("key", "board_sync").maybeSingle();
        boardLastSynced = (s.data as any)?.value?.last_synced_at ?? null;
      } catch { /* 未設定は無視 */ }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  // F-4: 原価をサーバ側でマスク（bill はそのまま）
  // ※ サマリーKPI（稼働中名数・月次売上・勤怠未チェック・請求書未送付）は /analytics に集約。
  const masked = rows.map((e) => ({ ...maskEngagement(e, role), bill: e.bill ?? null }));

  const canManage = role === "admin" || isBackoffice;

  return (
    <div className="page">
      <ProgressTabs />
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Engagements · 稼働管理</div>
          <h1>稼働管理</h1>
          <div className="sub"><b>月初業務</b>（勤怠チェック・請求書送付）と<b>契約管理</b>をタブで切り分け。<b>請求書は board で作成・送付</b>し、ENGER は送付完了のチェックのみ（二重管理なし）。<b>勤怠表をアップロードするとAIが稼働時間を自動計算</b>します。集計KPIは<a href="/analytics" style={{ textDecoration: "underline" }}>分析</a>に集約しました。{agentScoped ? "自分が担当する稼働（提案者/パートナー/クロージング）のみ表示しています。" : "原価/粗利は権限と所属区分(PP/BP/FL)に応じて表示（PPプロパー給与は保護）。"}</div>
        </div>
      </div>

      <FlowSteps current="progress" sub={`${period} の業務`} />

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>稼働テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/schema-matching.sql</span>・<span className="mono">supabase/engagement-ops.sql</span>・<span className="mono">supabase/billing.sql</span>・<span className="mono">supabase/engagement-rate-changes.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && (
        <Workbench rows={masked} role={role} period={period} canManage={canManage} agentScoped={agentScoped} boardLastSynced={boardLastSynced} highlightEngagementId={highlightEngagementId} />
      )}
    </div>
  );
}
