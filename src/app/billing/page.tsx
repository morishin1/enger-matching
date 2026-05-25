import { Icons } from "@/components/icons";
import { BillingClient } from "@/components/BillingClient";
import { getBillingTasks, currentPeriod } from "@/lib/billing";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ period?: string; name?: string }> }) {
  const { period: p, name } = await searchParams;
  const period = /^\d{4}-\d{2}$/.test(p ?? "") ? (p as string) : currentPeriod();

  // エージェント（バックオフィス専任を除く）は自分が担当する稼働のみ。管理者・バックオフィスは全件。
  const access = await currentAccess();
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  const agentName = role === "agent" && !isBackoffice ? (access?.name ?? null) : null;

  const { tasks, available } = await getBillingTasks(period, { agentName });
  const focusName = (name ?? "").trim();

  const total = tasks.length;
  const attPending = tasks.filter((t) => t.attendance_status !== "確認済").length;
  const invPending = tasks.filter((t) => t.invoice_status !== "発行済").length;
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Billing · 請求・勤怠</div>
          <h1>請求・勤怠</h1>
          <div className="sub">稼働中の契約ごとに、当月の<b>勤怠チェック</b>と<b>請求書発行</b>を処理。<b>勤怠表をアップロードするとAIが稼働時間を自動計算</b>します（CSV/画像/PDF対応）。{agentName ? "自分が担当する稼働のみ表示しています。" : "両方終わるとタスクが消えます。"}</div>
        </div>
      </div>

      {focusName && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span>稼働管理から <b>{focusName}</b> さんの請求・勤怠を表示しています。下の一覧で対象月の勤怠/請求を処理してください。</span>
          <a href="/billing" style={{ color: "var(--color-brand-700,#0b5cab)", fontWeight: 600 }}>絞り込みを解除</a>
        </div>
      )}

      {!available && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 13 }}>
          <b>請求・勤怠テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/billing.sql</span> を実行し、Storage に公開バケット <span className="mono">billing</span> を作成してください。
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi warn"><div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip">勤怠</div></div><div><div className="val tnum">{attPending}<span className="unit">件</span></div><div className="label">勤怠 未チェック</div><div className="note">{period}</div></div></div>
        <div className="kpi warn"><div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">請求</div></div><div><div className="val tnum">{invPending}<span className="unit">件</span></div><div className="label">請求書 未発行</div><div className="note">{period}</div></div></div>
        <div className="kpi accent"><div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">完了</div></div><div><div className="val tnum">{done}<span className="unit">/{total}</span></div><div className="label">処理完了</div><div className="note">勤怠＋請求 両方</div></div></div>
        <div className="kpi brand"><div className="top"><div className="ico-box"><Icons.progress /></div><div className="chip flat">対象</div></div><div><div className="val tnum">{total}<span className="unit">件</span></div><div className="label">対象の稼働</div><div className="note">稼働中・予定</div></div></div>
      </div>

      {available && <BillingClient tasks={tasks} period={period} />}
    </div>
  );
}
