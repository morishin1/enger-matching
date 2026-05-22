import { Icons } from "@/components/icons";
import { ProposalBoard } from "@/components/ProposalBoard";
import { engerClient, dbConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  let proposals: any[] = [];
  let lost = 0;
  let dbError: string | null = null;
  let needSetup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, error } = await sb
        .from("proposals")
        .select("id, job_title, company, candidate_name, c_init, rate, score, stage, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) {
        needSetup = true;
      } else {
        const all = data ?? [];
        proposals = all.filter((p) => p.stage !== "失注");
        lost = all.filter((p) => p.stage === "失注").length;
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const active = proposals.length;
  const won = proposals.filter((p) => p.stage === "成約").length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Proposals · 提案管理</div>
          <h1>提案管理</h1>
          <div className="sub">マッチングで作成した提案を、提案中→面談→条件交渉→成約の流れでカンバン管理します。カードはドラッグ、または ← → で移動できます。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>提案テーブルが未作成です。</b> 中央 Supabase の SQL Editor で <span className="mono">supabase/schema-matching.sql</span> を実行すると、提案管理・稼働管理が使えるようになります。
        </div>
      )}

      {!needSetup && (
        <>
          <div className="kpi-grid">
            <div className="kpi brand">
              <div className="top"><div className="ico-box"><Icons.proposals /></div><div className="chip flat">進行中</div></div>
              <div><div className="val tnum">{active}<span className="unit">件</span></div><div className="label">進行中の提案</div><div className="note">失注を除く</div></div>
            </div>
            <div className="kpi accent">
              <div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">成約</div></div>
              <div><div className="val tnum">{won}<span className="unit">件</span></div><div className="label">成約</div><div className="note">稼働化できます</div></div>
            </div>
            <div className="kpi">
              <div className="top"><div className="ico-box"><Icons.bolt /></div><div className="chip flat">失注</div></div>
              <div><div className="val tnum">{lost}<span className="unit">件</span></div><div className="label">失注</div><div className="note">ボード外</div></div>
            </div>
            <div className="kpi warn">
              <div className="top"><div className="ico-box"><Icons.matching /></div><div className="chip">導線</div></div>
              <div><div className="val" style={{ fontSize: 16 }}>マッチング→提案</div><div className="label">提案の作り方</div><div className="note">マッチング詳細で記録</div></div>
            </div>
          </div>

          {proposals.length === 0 ? (
            <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
              まだ提案がありません。<b style={{ color: "var(--color-ink-2)" }}>マッチング</b>画面でペアを選び、「提案ボードに記録」を押すとここに表示されます。
            </div>
          ) : (
            <ProposalBoard proposals={proposals} />
          )}
        </>
      )}
    </div>
  );
}
