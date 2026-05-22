import { Icons } from "@/components/icons";
import { EngagementsView } from "@/components/EngagementsView";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ProgressPage() {
  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, error } = await sb
        .from("engagements")
        .select("id, job_title, company, candidate_name, monthly_rate, start_date, end_date, status, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) needSetup = true;
      else rows = data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const active = rows.filter((e) => e.status === "稼働中").length;
  const planned = rows.filter((e) => e.status === "予定").length;
  const ended = rows.filter((e) => e.status === "終了").length;
  const mrr = rows.filter((e) => e.status === "稼働中").reduce((a, e) => a + (Number(e.monthly_rate) || 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Engagements · 稼働管理</div>
          <h1>稼働管理</h1>
          <div className="sub">成約した提案を「稼働化」するとここに登録されます。予定 → 稼働中 → 終了 をワンクリックで更新できます。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>稼働テーブルが未作成です。</b> SQL Editor で <span className="mono">supabase/schema-matching.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && (
        <>
          <div className="kpi-grid">
            <div className="kpi brand">
              <div className="top"><div className="ico-box"><Icons.progress /></div><div className="chip flat">稼働</div></div>
              <div><div className="val tnum">{active}<span className="unit">名</span></div><div className="label">稼働中</div><div className="note">現在アサイン中</div></div>
            </div>
            <div className="kpi accent">
              <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">月額</div></div>
              <div><div className="val tnum">{mrr.toLocaleString("ja-JP")}<span className="unit">万</span></div><div className="label">月次売上(稼働中)</div><div className="note">monthly_rate 合計</div></div>
            </div>
            <div className="kpi">
              <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip flat">予定</div></div>
              <div><div className="val tnum">{planned}<span className="unit">名</span></div><div className="label">稼働予定</div><div className="note">開始待ち</div></div>
            </div>
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">終了</div></div>
              <div><div className="val tnum">{ended}<span className="unit">名</span></div><div className="label">終了</div><div className="note">契約満了</div></div>
            </div>
          </div>

          <EngagementsView rows={rows} />
        </>
      )}
    </div>
  );
}
