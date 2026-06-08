import { ProposalsWorkspace } from "@/components/ProposalsWorkspace";
import { NewProposalButton } from "@/components/NewProposalButton";
import { FlowSteps } from "@/components/FlowSteps";
import { NextStepLink } from "@/components/NextStepLink";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { getStaff } from "@/lib/staff";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getFeedbackMap, VERDICT_LABEL, type Verdict } from "@/lib/client-feedback";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  let proposals: any[] = [];
  let lost = 0;
  let dbError: string | null = null;
  let needSetup = false;
  // 提案開始件数（created_at 基準）。ステージ移動の影響を受けず一貫してカウントする。
  let startStats = { today: 0, week: 0, month: 0, thirty: 0 };

  const [staff, proposalOwners] = await Promise.all([getStaff(), loadProposalOwners()]);
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
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, meeting_time, meeting_format, meeting_url, meeting_attendees, meeting_note, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals")
        .select(`${base}, updated_at, stage_updated_at, caller_status, proposer, partner, closer, client_contact, lost_reason, lost_phase, lost_reason_note, meeting_date, meeting_status, source, job_notify_status, cand_notify_status, job_action_type, cand_action_type`)
        .order("created_at", { ascending: false }).limit(400);
      if (res.error) res = await sb.from("proposals")
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
        // 補助情報を 4 クエリ並列で取得（旧: 逐次 4 往復 → 新: 1 往復ぶんに短縮）。
        //   ① job_id → job_no/source_mail_url
        //   ② candidate_id → candidate_no/source_mail_url
        //   ③ job_title → outside_owner（営業担当）
        //   ④ company name → owner（営業担当）
        const jobIds   = Array.from(new Set(all.map((p: any) => p.job_id).filter(Boolean))) as string[];
        const candIds  = Array.from(new Set(all.map((p: any) => p.candidate_id).filter(Boolean))) as string[];
        const titles   = Array.from(new Set(all.map((p: any) => p.job_title).filter(Boolean))) as string[];
        const compNms  = Array.from(new Set(all.map((p: any) => p.company).filter(Boolean))) as string[];

        const nq = (rows: any[] | null) => rows ?? [];
        // ① 案件: 元メール本文(detail)も取得 → ドロワーの2カラム比較に使う。列が無ければ source_mail_url だけにフォールバック。
        const fetchJobs = async () => {
          if (!jobIds.length) return [];
          let r: any = await sb.from("jobs").select("id, job_no, source_mail_url, detail").in("id", jobIds).limit(2000);
          if (r.error) r = await sb.from("jobs").select("id, job_no, source_mail_url").in("id", jobIds).limit(2000);
          return r.error ? [] : nq(r.data);
        };
        // ② 人材: 元メール本文(note)も取得。列が無ければ exp、それも無ければ source_mail_url だけ。
        const fetchCands = async () => {
          if (!candIds.length) return [];
          let r: any = await sb.from("candidates").select("id, candidate_no, source_mail_url, note, exp").in("id", candIds).limit(2000);
          if (r.error) r = await sb.from("candidates").select("id, candidate_no, source_mail_url").in("id", candIds).limit(2000);
          return r.error ? [] : nq(r.data);
        };
        const [jn, cn, jr, cr] = await Promise.all([
          fetchJobs(),
          fetchCands(),
          titles.length  ? sb.from("jobs").select("title, outside_owner").in("title", titles).limit(1000).then((r: any) => r.error ? [] : nq(r.data)) : Promise.resolve([]),
          compNms.length ? sb.from("companies").select("name, owner").in("name", compNms).limit(1000).then((r: any) => r.error ? [] : nq(r.data)) : Promise.resolve([]),
        ]);

        try {
          const mJ: Record<string, { job_no: number; url: string | null; detail: string | null }> = {};
          for (const j of jn as any[]) if (j?.id != null) mJ[j.id] = { job_no: j.job_no, url: j.source_mail_url ?? null, detail: j.detail ?? null };
          const mC: Record<string, { candidate_no: number; url: string | null; detail: string | null }> = {};
          for (const c of cn as any[]) if (c?.id != null) mC[c.id] = { candidate_no: c.candidate_no, url: c.source_mail_url ?? null, detail: c.note ?? c.exp ?? null };
          const ownerByTitle: Record<string, string> = {};
          for (const j of jr as any[]) if (j?.outside_owner) ownerByTitle[j.title] = j.outside_owner;
          const ownerByCompany: Record<string, string> = {};
          for (const c of cr as any[]) if (c?.owner) ownerByCompany[c.name] = c.owner;
          for (const p of all) {
            if (p.job_id && mJ[p.job_id])       { p.job_no = mJ[p.job_id].job_no; p.job_source_mail_url = mJ[p.job_id].url; p.job_detail = mJ[p.job_id].detail; }
            if (p.candidate_id && mC[p.candidate_id]) { p.candidate_no = mC[p.candidate_id].candidate_no; p.cand_source_mail_url = mC[p.candidate_id].url; p.cand_detail = mC[p.candidate_id].detail; }
            p.company_owner = ownerByTitle[p.job_title] ?? ownerByCompany[p.company] ?? null;
          }
        } catch { /* 列未整備でも続行 */ }
        // 稼働化済(稼働/旧稼働決定)・見送り・失注 はボードから除外
        proposals = all.filter((p: any) => !["見送り", "失注", "稼働", "稼働決定"].includes(p.stage));
        lostRows = all.filter((p: any) => p.stage === "見送り" || p.stage === "失注");
        lost = lostRows.length;
        // 提案履歴：進行中＋終了（見送り/失注/稼働）すべてを時系列で表示。
        // マッチングから提案した直後のものをここで確認できる。
        history = all
          .slice() // 元配列を破壊しない
          .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
          .slice(0, 400);
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
          <div className="sub"><b>所属確認 → 提案中 → 面談 → 合格</b> の4ステップで管理します。①情報が届いたら案件先「まだ募集中？」・人材先「まだ営業できる？」を<b>所属確認</b>→②両方OKで<b>提案</b>（LINE/メール等の社外連絡もメモにコピペ）→③双方マッチで<b>面談</b>→④<b>合格</b>の「稼働化」で稼働管理へ。提案は2人1組（提案者＋パートナー）で進めます。</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
          <NextStepLink href="/progress" label="稼働管理を見る" hint="面談合格→稼働化したエンゲージメントへ" />
          <NewProposalButton />
        </div>
      </div>

      <FlowSteps current="proposals" sub="ステージ進行・クロージング" />

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>提案テーブルが未作成です。</b> 中央 Supabase の SQL Editor で <span className="mono">supabase/schema-matching.sql</span> を実行すると、提案管理・稼働管理が使えるようになります。
        </div>
      )}

      {!needSetup && (
        <>
          <ProposalsWorkspace
            proposals={proposals}
            history={history}
            analyticsRows={analyticsRows}
            members={staff.members}
            proposers={proposalOwners?.proposers}
            closers={proposalOwners?.closers}
            fallbackBanner={
              <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
                まだ提案がありません。<b style={{ color: "var(--color-ink-2)" }}>マッチング</b>画面でペアを選び、「提案ボードに記録」を押すとここに表示されます。
              </div>
            }
          />
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
      )}
    </div>
  );
}
