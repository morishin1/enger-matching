import { Icons } from "@/components/icons";
import { DocumentTasks } from "@/components/DocumentTasks";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const DAY = 86400000;
const daysUntil = (d?: string | null) => {
  if (!d) return null;
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  return Math.floor((new Date(d).getTime() - t0.getTime()) / DAY);
};

export default async function DocumentsPage() {
  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  const access = await currentAccess();
  const role = access?.role ?? "admin";
  const isBackoffice = (access?.functions ?? []).includes("バックオフィス");
  const canManage = role === "admin" || isBackoffice;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const res = await sb.from("document_tasks")
        .select("id, party, counterparty, subject, doc_type, due_date, status, note, created_at")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (res.error) needSetup = true;
      else rows = res.data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const openRows = rows.filter((r) => r.status !== "完了");
  const pending = openRows.filter((r) => (r.status ?? "未送付") === "未送付").length;
  const overdue = openRows.filter((r) => { const d = daysUntil(r.due_date); return d != null && d < 0; }).length;
  const soon = openRows.filter((r) => { const d = daysUntil(r.due_date); return d != null && d >= 0 && d <= 7; }).length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Documents · 書類送付</div>
          <h1>書類送付</h1>
          <div className="sub">取引先（<b>上位／下位</b>）への契約書類（基本契約・個別契約・注文書・注文請書・NDA 等）の<b>送付期限と送付状況</b>を手動で管理。送付漏れ・期限超過を防ぎます。{canManage ? "" : "（閲覧のみ）"}</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>書類送付テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/document-tasks.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && (
        <>
          <div className="kpi-grid">
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.doc /></div><div className="chip">未送付</div></div>
              <div><div className="val tnum">{pending}<span className="unit">件</span></div><div className="label">未送付</div><div className="note">送付待ちの書類</div></div>
            </div>
            <div className="kpi danger">
              <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip flat">超過</div></div>
              <div><div className="val tnum">{overdue}<span className="unit">件</span></div><div className="label">期限超過</div><div className="note">未完了で期限切れ</div></div>
            </div>
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip">間近</div></div>
              <div><div className="val tnum">{soon}<span className="unit">件</span></div><div className="label">7日以内が期限</div><div className="note">未完了</div></div>
            </div>
          </div>

          <DocumentTasks rows={rows} canManage={canManage} />
        </>
      )}
    </div>
  );
}
