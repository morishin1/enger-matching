import { ProposalBoard } from "@/components/ProposalBoard";
import { ProposalHistory } from "@/components/ProposalHistory";
import { ProposalsTabs } from "@/components/ProposalsTabs";
import { LostAnalytics } from "@/components/LostAnalytics";
import { NewProposalButton } from "@/components/NewProposalButton";
import { ProposalStartStats } from "@/components/ProposalStartStats";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { getFeedbackMap, VERDICT_LABEL, type Verdict } from "@/lib/client-feedback";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  let proposals: any[] = [];
  let lost = 0;
  let dbError: string | null = null;
  let needSetup = false;
  // 提案開始件数（created_at 基準）。ステージ移動の影響を受けず一貫してカウントする。
  let startStats = { today: 0, week: 0, month: 0, thirty: 0 };

  const staff = await getStaff();
  let lostRows: any[] = [];
  let history: any[] = [];
  let analyticsRows: any[] = [];
  let feedbackList: { verdict: Verdict; reason: string | null; c_init: string; job_title: string; company: string; updated_at: string }[] = [];
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const base = "id, job_id, candidate_id, job_title, company, candidate_name, c_init, rate, score, stage, created_at";
      // 拡張カラム(架電進捗等)が無くても落ちないようフォールバック
      let res: any = await sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, source`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status, source`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, meeting_date, meeting_status`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals")
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
        // 案件名 → /matching?job=<job_no>&cand=<candidate_no> のリンク用に job_id → job_no と candidate_id → candidate_no を解決
        try {
          const jobIds = Array.from(new Set(all.map((p: any) => p.job_id).filter(Boolean)));
          if (jobIds.length) {
            const jn: any = await sb.from("jobs").select("id, job_no").in("id", jobIds as string[]).limit(2000);
            if (!jn.error) {
              const m: Record<string, number> = {};
              for (const j of (jn.data ?? [])) if (j.id != null && j.job_no != null) m[j.id] = j.job_no;
              for (const p of all) if (p.job_id && m[p.job_id] != null) p.job_no = m[p.job_id];
            }
          }
          const candIds = Array.from(new Set(all.map((p: any) => p.candidate_id).filter(Boolean)));
          if (candIds.length) {
            const cn: any = await sb.from("candidates").select("id, candidate_no").in("id", candIds as string[]).limit(2000);
            if (!cn.error) {
              const m: Record<string, number> = {};
              for (const c of (cn.data ?? [])) if (c.id != null && c.candidate_no != null) m[c.id] = c.candidate_no;
              for (const p of all) if (p.candidate_id && m[p.candidate_id] != null) p.candidate_no = m[p.candidate_id];
            }
          }
        } catch { /* 解決失敗時はリンク無し（フォールバック） */ }
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
        // 失注分析用は勝率計算のため稼働/稼働決定も含める。期間フィルタはクライアント側で行う
        analyticsRows = all.filter((p: any) => ["見送り", "失注", "稼働", "稼働決定"].includes(p.stage));
        // 企業フィードバックを紐付け（ミスマッチ低減の材料）
        const fbMap = await getFeedbackMap(all.map((p: any) => p.id));
        feedbackList = all
          .filter((p: any) => fbMap[p.id])
          .map((p: any) => ({ verdict: fbMap[p.id].verdict, reason: fbMap[p.id].reason, c_init: p.c_init || "人材", job_title: p.job_title || "—", company: p.company || "—", updated_at: fbMap[p.id].updated_at }))
          .sort((a: any, b: any) => (a.updated_at < b.updated_at ? 1 : -1));

        // 「提案開始件数」の固定期間集計（DB の正確な COUNT・400件上限の影響を受けない）
        const now = Date.now();
        const dayMs = 24 * 3600 * 1000;
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const isos = {
          today:  startOfToday.toISOString(),
          week:   new Date(now - 6 * dayMs).toISOString(),
          month:  new Date(now - 29 * dayMs).toISOString(),
          thirty: new Date(now - 29 * dayMs).toISOString(),
        };
        const [tc, wc, mc, ttc] = await Promise.all([
          sb.from("proposals").select("id", { count: "exact", head: true }).gte("created_at", isos.today),
          sb.from("proposals").select("id", { count: "exact", head: true }).gte("created_at", isos.week),
          sb.from("proposals").select("id", { count: "exact", head: true }).gte("created_at", isos.month),
          sb.from("proposals").select("id", { count: "exact", head: true }).gte("created_at", isos.thirty),
        ]);
        startStats = { today: tc.count ?? 0, week: wc.count ?? 0, month: mc.count ?? 0, thirty: ttc.count ?? 0 };
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Proposals · 提案管理</div>
          <h1>提案管理</h1>
          <div className="sub"><b>返信待ち → 提案中 → 面談調整 → クロージング中 → 面談合格</b> のカンバン。「返信待ち」は提案メール送信済みで先方の反応待ちのキューです。提案は<b>2人1組（提案者＋パートナー）</b>で進め、クロージング担当は2人のうちどちらかをカードで選べます。面談合格の「稼働化」で<b>稼働管理</b>へ移ります。</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          <NewProposalButton />
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>提案テーブルが未作成です。</b> 中央 Supabase の SQL Editor で <span className="mono">supabase/schema-matching.sql</span> を実行すると、提案管理・稼働管理が使えるようになります。
        </div>
      )}

      {!needSetup && <ProposalStartStats today={startStats.today} week={startStats.week} month={startStats.month} thirty={startStats.thirty} />}

      {!needSetup && (
        <ProposalsTabs
          boardCount={proposals.length}
          historyCount={history.length}
          lostCount={lost}
          board={
            proposals.length === 0 ? (
              <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
                まだ提案がありません。<b style={{ color: "var(--color-ink-2)" }}>マッチング</b>画面でペアを選び、「提案ボードに記録」を押すとここに表示されます。
              </div>
            ) : (
              <>
                <ProposalBoard proposals={proposals} members={staff.members} />
                {feedbackList.length > 0 && (
                  <div className="card" style={{ marginTop: 14 }}>
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
              </>
            )
          }
          history={history.length > 0 ? <ProposalHistory items={history} /> : null}
          lostSummary={analyticsRows.length > 0 ? <LostAnalytics history={analyticsRows} /> : null}
        />
      )}
    </div>
  );
}
