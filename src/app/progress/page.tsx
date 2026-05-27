import { Icons } from "@/components/icons";
import { Workbench } from "@/components/Workbench";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canSeeMargin, maskEngagement } from "@/lib/engagement-access";
import { currentPeriod } from "@/lib/billing";

export const dynamic = "force-dynamic";

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: pRaw } = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(pRaw ?? "") ? (pRaw as string) : currentPeriod();

  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  const access = await currentAccess();
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  const agentScoped = role === "agent" && !isBackoffice;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, proposal_id, job_title, company, candidate_name, monthly_rate, start_date, end_date, status, created_at";
      const rich = `${base}, cost, affiliation, settle_min, settle_max, work_hours, contract_status, po_status, renewal_due, renewal_status`;
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
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  // サマリー
  const active = rows.filter((e) => e.status === "稼働中").length;
  const planned = rows.filter((e) => e.status === "予定").length;
  const ended = rows.filter((e) => e.status === "終了").length;
  const liveRows = rows.filter((e) => e.status === "稼働中");
  const mrr = liveRows.reduce((a, e) => a + (Number(e.monthly_rate) || 0), 0);
  const visibleGrossRows = liveRows.filter((e) => canSeeMargin(role, e.affiliation) && e.cost != null);
  const grossSum = visibleGrossRows.reduce((a, e) => a + ((Number(e.monthly_rate) || 0) - (Number(e.cost) || 0)), 0);
  const grossHidden = liveRows.length - visibleGrossRows.length;
  // 当月タスク（稼働中・予定が対象）
  const taskRows = rows.filter((e) => e.status === "稼働中" || e.status === "予定");
  const attPending = taskRows.filter((e) => (e.bill?.attendance_status ?? "未") !== "確認済").length;
  const invSent = (s?: string | null) => s === "送付完了" || s === "発行済";
  const invPending = taskRows.filter((e) => !invSent(e.bill?.invoice_status)).length;

  // F-4: 原価をサーバ側でマスク（bill はそのまま）
  const masked = rows.map((e) => ({ ...maskEngagement(e, role), bill: e.bill ?? null }));

  const canManage = role === "admin" || isBackoffice;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Engagements · 稼働管理</div>
          <h1>稼働管理</h1>
          <div className="sub">稼働中の契約・粗利・精算に加えて、<b>当月の勤怠チェックと請求書の送付状況</b>を同じ画面で処理。<b>請求書は board で作成・送付</b>し、ENGER では送付完了をチェックするだけ（二重管理なし）。<b>勤怠表をアップロードするとAIが稼働時間を自動計算</b>します。{agentScoped ? "自分が担当する稼働のみ表示しています。" : "原価/粗利は権限と所属区分(PP/BP/FL)に応じて表示（PPプロパー給与は保護）。"}</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>稼働テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/schema-matching.sql</span>・<span className="mono">supabase/engagement-ops.sql</span>・<span className="mono">supabase/billing.sql</span>・<span className="mono">supabase/engagement-rate-changes.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && (
        <>
          <div className="kpi-grid">
            <div className="kpi brand">
              <div className="top"><div className="ico-box"><Icons.progress /></div><div className="chip flat">稼働</div></div>
              <div><div className="val tnum">{active}<span className="unit">名</span></div><div className="label">稼働中</div><div className="note">予定 {planned} / 終了 {ended}</div></div>
            </div>
            <div className="kpi accent">
              <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">売上</div></div>
              <div><div className="val tnum">{mrr.toLocaleString("ja-JP")}<span className="unit">万</span></div><div className="label">月次売上(稼働中)</div><div className="note">請求ベース</div></div>
            </div>
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip">勤怠</div></div>
              <div><div className="val tnum">{attPending}<span className="unit">件</span></div><div className="label">勤怠 未チェック</div><div className="note">{period}</div></div>
            </div>
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">請求</div></div>
              <div><div className="val tnum">{invPending}<span className="unit">件</span></div><div className="label">請求書 未送付</div><div className="note">{period}</div></div>
            </div>
          </div>

          <Workbench rows={masked} role={role} period={period} canManage={canManage} agentScoped={agentScoped} />
        </>
      )}
    </div>
  );
}
