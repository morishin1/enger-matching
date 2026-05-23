import { Icons } from "@/components/icons";
import { EngagementsView } from "@/components/EngagementsView";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canSeeMargin, maskEngagement } from "@/lib/engagement-access";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  const access = await currentAccess();
  const role = access?.role ?? "admin";

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, job_title, company, candidate_name, monthly_rate, start_date, end_date, status, created_at";
      const rich = `${base}, cost, affiliation, settle_min, settle_max, work_hours, contract_status, po_status, renewal_due, renewal_status`;
      let res: any = await sb.from("engagements").select(rich).order("created_at", { ascending: false }).limit(300);
      if (res.error) res = await sb.from("engagements").select(base).order("created_at", { ascending: false }).limit(300);
      if (res.error) needSetup = true;
      else rows = res.data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  // サマリー（売上=monthly_rate は全員可視。粗利は閲覧可能な行のみ集計：F-5）
  const active = rows.filter((e) => e.status === "稼働中").length;
  const planned = rows.filter((e) => e.status === "予定").length;
  const ended = rows.filter((e) => e.status === "終了").length;
  const liveRows = rows.filter((e) => e.status === "稼働中");
  const mrr = liveRows.reduce((a, e) => a + (Number(e.monthly_rate) || 0), 0);
  const visibleGrossRows = liveRows.filter((e) => canSeeMargin(role, e.affiliation) && e.cost != null);
  const grossSum = visibleGrossRows.reduce((a, e) => a + ((Number(e.monthly_rate) || 0) - (Number(e.cost) || 0)), 0);
  const grossHidden = liveRows.length - visibleGrossRows.length;

  // F-4: 原価をサーバ側でマスクしてからクライアントへ
  const masked = rows.map((e) => maskEngagement(e, role));

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Engagements · 稼働管理</div>
          <h1>稼働管理</h1>
          <div className="sub">契約更新・粗利・精算・契約書回収を一元管理。原価/粗利は権限と所属区分に応じて表示されます（プロパー給与は保護）。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>稼働テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/schema-matching.sql</span> と <span className="mono">supabase/engagement-ops.sql</span> を実行してください。
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
            <div className="kpi">
              <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip flat">粗利</div></div>
              <div><div className="val tnum">{grossSum.toLocaleString("ja-JP")}<span className="unit">万</span></div><div className="label">月次粗利{role !== "admin" ? "（閲覧可分）" : ""}</div><div className="note">{grossHidden > 0 ? `${grossHidden}名は権限/未入力で非集計` : "売上−原価"}</div></div>
            </div>
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip">更新</div></div>
              <div><div className="val tnum">{liveRows.filter((e) => { const d = e.end_date ? Math.floor((new Date(e.end_date).getTime() - Date.now()) / 86400000) : null; return d != null && d >= 0 && d <= 31; }).length}<span className="unit">名</span></div><div className="label">30日以内に満了</div><div className="note">契約更新アラート</div></div>
            </div>
          </div>

          <EngagementsView rows={masked} role={role} />
        </>
      )}
    </div>
  );
}
