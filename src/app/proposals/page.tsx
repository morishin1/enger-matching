import { Icons } from "@/components/icons";
import { ProposalBoard } from "@/components/ProposalBoard";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  let proposals: any[] = [];
  let lost = 0;
  let dbError: string | null = null;
  let needSetup = false;

  const staff = await getStaff();
  let lostRows: any[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, job_title, company, candidate_name, c_init, rate, score, stage, created_at";
      // 拡張カラム(架電進捗等)が無くても落ちないようフォールバック
      let res: any = await sb.from("proposals")
        .select(`${base}, caller_status, proposer, closer, client_contact, lost_reason, lost_phase`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals").select(base).order("created_at", { ascending: false }).limit(400);
      if (res.error) {
        needSetup = true;
      } else {
        const all = res.data ?? [];
        proposals = all.filter((p: any) => p.stage !== "見送り" && p.stage !== "失注");
        lostRows = all.filter((p: any) => p.stage === "見送り" || p.stage === "失注");
        lost = lostRows.length;
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const active = proposals.length;
  const won = proposals.filter((p) => p.stage === "稼働決定").length;

  // 失注理由サマリー（上位）
  const reasonCounts = lostRows.reduce((m: Record<string, number>, p) => {
    const k = p.lost_reason || "（理由未入力）"; m[k] = (m[k] ?? 0) + 1; return m;
  }, {});
  const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Proposals · 提案管理</div>
          <h1>提案管理</h1>
          <div className="sub">インサイド運用に準拠：<b>未対応 → 提案中 → 面談調整 → クロージング中 → 稼働決定</b> のカンバン。各カードで架電進捗・提案者/クロージング担当・失注理由を管理できます。</div>
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
              <div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">稼働決定</div></div>
              <div><div className="val tnum">{won}<span className="unit">件</span></div><div className="label">稼働決定</div><div className="note">稼働化できます</div></div>
            </div>
            <div className="kpi">
              <div className="top"><div className="ico-box"><Icons.bolt /></div><div className="chip flat">見送り</div></div>
              <div><div className="val tnum">{lost}<span className="unit">件</span></div><div className="label">見送り（失注）</div><div className="note">理由を下に集計</div></div>
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
            <ProposalBoard proposals={proposals} proposers={staff.proposers} closers={staff.closers} />
          )}

          {topReasons.length > 0 && (
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>💔 失注理由サマリー</h3>
                <span className="muted" style={{ fontSize: 11.5 }}>見送り {lost} 件</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topReasons.map(([reason, n]) => {
                  const w = Math.round((n / lost) * 100);
                  return (
                    <div key={reason} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr 36px", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reason}</span>
                      <div style={{ height: 8, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${w}%`, height: "100%", background: "var(--color-danger)", borderRadius: 99 }} />
                      </div>
                      <span className="mono tnum" style={{ fontSize: 11.5, textAlign: "right", color: "var(--color-ink-3)" }}>{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
