import { Icons } from "@/components/icons";
import { ProposalBoard } from "@/components/ProposalBoard";
import { ProposalHistory } from "@/components/ProposalHistory";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { getFeedbackMap, VERDICT_LABEL, type Verdict } from "@/lib/client-feedback";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  let proposals: any[] = [];
  let lost = 0;
  let dbError: string | null = null;
  let needSetup = false;

  const staff = await getStaff();
  let lostRows: any[] = [];
  let history: any[] = [];
  let feedbackList: { verdict: Verdict; reason: string | null; c_init: string; job_title: string; company: string; updated_at: string }[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, job_title, company, candidate_name, c_init, rate, score, stage, created_at";
      // 拡張カラム(架電進捗等)が無くても落ちないようフォールバック
      let res: any = await sb.from("proposals")
        .select(`${base}, updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status`)
        .order("created_at", { ascending: false }).limit(400);
      // partner / updated_at 列が無い環境でも落ちないようフォールバック
      if (res.error) res = await sb.from("proposals")
        .select(`${base}, caller_status, proposer, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals").select(base).order("created_at", { ascending: false }).limit(400);
      if (res.error) {
        needSetup = true;
      } else {
        const all = res.data ?? [];
        // 企業担当（案件の outside_owner / 企業マスタ owner）を解決し、各提案に company_owner として付与
        try {
          const titles = Array.from(new Set(all.map((p: any) => p.job_title).filter(Boolean)));
          const names = Array.from(new Set(all.map((p: any) => p.company).filter(Boolean)));
          const ownerByTitle: Record<string, string> = {};
          const ownerByCompany: Record<string, string> = {};
          if (titles.length) {
            let jr: any = await sb.from("jobs").select("title, outside_owner").in("title", titles as string[]).limit(1000);
            if (!jr.error) for (const j of (jr.data ?? [])) if (j.outside_owner) ownerByTitle[j.title] = j.outside_owner;
          }
          if (names.length) {
            const cr: any = await sb.from("companies").select("name, owner").in("name", names as string[]).limit(1000);
            if (!cr.error) for (const c of (cr.data ?? [])) if (c.owner) ownerByCompany[c.name] = c.owner;
          }
          for (const p of all) p.company_owner = ownerByTitle[p.job_title] ?? ownerByCompany[p.company] ?? null;
        } catch { /* 列未整備でも続行 */ }
        // 稼働化済(稼働/旧稼働決定)・見送り・失注 はボードから除外
        proposals = all.filter((p: any) => !["見送り", "失注", "稼働", "稼働決定"].includes(p.stage));
        lostRows = all.filter((p: any) => p.stage === "見送り" || p.stage === "失注");
        lost = lostRows.length;
        // 過去の提案（履歴）：見送り/失注/稼働化済を新しい順に
        history = all
          .filter((p: any) => ["見送り", "失注", "稼働", "稼働決定"].includes(p.stage))
          .sort((a: any, b: any) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))
          .slice(0, 200);
        // 企業フィードバックを紐付け（ミスマッチ低減の材料）
        const fbMap = await getFeedbackMap(all.map((p: any) => p.id));
        feedbackList = all
          .filter((p: any) => fbMap[p.id])
          .map((p: any) => ({ verdict: fbMap[p.id].verdict, reason: fbMap[p.id].reason, c_init: p.c_init || "人材", job_title: p.job_title || "—", company: p.company || "—", updated_at: fbMap[p.id].updated_at }))
          .sort((a: any, b: any) => (a.updated_at < b.updated_at ? 1 : -1));
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const active = proposals.length;
  const passed = proposals.filter((p) => p.stage === "面談合格").length;

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
          <div className="sub"><b>未対応 → 提案中 → 面談調整 → クロージング中 → 面談合格</b> のカンバン。提案は<b>2人1組（提案者＋パートナー）</b>で進め、クロージング担当は2人のうちどちらかをカードで選べます。面談合格の「稼働化」で<b>稼働管理</b>へ移ります。</div>
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
              <div className="top"><div className="ico-box"><Icons.check /></div><div className="chip">面談合格</div></div>
              <div><div className="val tnum">{passed}<span className="unit">件</span></div><div className="label">面談合格</div><div className="note">「稼働化」で稼働管理へ</div></div>
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
            <ProposalBoard proposals={proposals} members={staff.members} />
          )}

          {feedbackList.length > 0 && (
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>🗣 企業からの評価（ミスマッチ低減）</h3>
                <span className="muted" style={{ fontSize: 11.5 }}>{feedbackList.length} 件</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {feedbackList.slice(0, 12).map((f, i) => {
                  const tone = f.verdict === "want" ? { bg: "#e7f7ee", fg: "#067647" } : f.verdict === "mismatch" ? { bg: "#fdecef", fg: "#b42318" } : { bg: "#fff5e6", fg: "#b45309" };
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                      <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: tone.bg, color: tone.fg }}>{VERDICT_LABEL[f.verdict]}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.company}<span className="muted" style={{ fontWeight: 400 }}> ・ {f.c_init} ・ {f.job_title}</span></div>
                        {f.reason && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>「{f.reason}」</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--color-ink-4)" }}>※ ユーザー企業ポータルの「おすすめ人材」で企業が返した評価です。ミスマッチ理由を次の提案に反映しましょう。</div>
            </div>
          )}

          {history.length > 0 && <ProposalHistory items={history} />}

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
