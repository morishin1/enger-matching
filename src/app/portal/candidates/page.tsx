import { redirect } from "next/navigation";
import { engerClient, publicAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { overlapSkills } from "@/lib/match";
import { getFeedbackMap } from "@/lib/client-feedback";
import { CandidateRecommendations, type RecoCandidate } from "@/components/CandidateRecommendations";
import { PortalTalentList, type PortalTalent } from "@/components/PortalTalentList";

export const dynamic = "force-dynamic";

/** ユーザー企業(client)向け：自社案件に提案された人材を、マッチ度＋根拠つきで表示しFBを受ける。 */
export default async function PortalCandidatesPage() {
  const access = await currentAccess();
  if (access && access.role !== "client") redirect("/");

  const companyName = access?.companyName ?? null;
  let items: RecoCandidate[] = [];
  let talent: PortalTalent[] = [];
  let note: string | null = null;

  if (!companyName) {
    note = "アカウントに会社名が未設定です。管理者に会社名の登録を依頼してください。";
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${companyName}%`;
      const { data: props } = await sb.from("proposals")
        .select("id, stage, score, ai_match, c_init, rate, job_title, candidate_id, job_id")
        .ilike("company", like).order("created_at", { ascending: false }).limit(100);
      const proposals = props ?? [];

      const candIds = [...new Set(proposals.map((p: any) => p.candidate_id).filter(Boolean))];
      const jobIds = [...new Set(proposals.map((p: any) => p.job_id).filter(Boolean))];
      const [candRes, jobRes, fbMap] = await Promise.all([
        candIds.length ? sb.from("candidates").select("id, initials, title, skills, rate_num").in("id", candIds) : Promise.resolve({ data: [] as any[] }),
        jobIds.length ? sb.from("jobs").select("id, title, skills").in("id", jobIds) : Promise.resolve({ data: [] as any[] }),
        getFeedbackMap(proposals.map((p: any) => p.id)),
      ]);
      const candMap = new Map((candRes.data ?? []).map((c: any) => [c.id, c]));
      const jobMap = new Map((jobRes.data ?? []).map((j: any) => [j.id, j]));

      items = proposals.map((p: any) => {
        const c = p.candidate_id ? candMap.get(p.candidate_id) : null;
        const j = p.job_id ? jobMap.get(p.job_id) : null;
        const candSkills: string[] = c?.skills ?? [];
        const jobSkills: string[] = j?.skills ?? [];
        const matched = overlapSkills(jobSkills, candSkills);
        const score = Number(p.ai_match ?? p.score ?? 0) || 0;
        const fb = fbMap[p.id];
        return {
          proposalId: p.id,
          init: p.c_init || c?.initials || "人材",
          title: c?.title ?? null,
          jobTitle: p.job_title ?? j?.title ?? null,
          stage: p.stage ?? null,
          rate: p.rate ?? (c?.rate_num ? `¥${Math.round(c.rate_num)}万` : null),
          score,
          matchedSkills: matched,
          otherSkills: candSkills.filter((s) => !matched.includes(s)).slice(0, 6),
          verdict: fb?.verdict ?? null,
          reason: fb?.reason ?? null,
        } as RecoCandidate;
      })
      // マッチ度が高い順
      .sort((a, b) => b.score - a.score);

      // ── おすすめ人材（匿名マッチ）: 自社案件のスキルに合う人材を candidates と LP登録から ──
      try {
        const { data: cjobs } = await sb.from("jobs").select("skills").ilike("client_name", like).eq("is_published", true).limit(300);
        const compSkills = new Set<string>();
        for (const j of (cjobs ?? []) as any[]) for (const s of (j.skills ?? [])) compSkills.add(String(s).toLowerCase());
        const ov = (skills: string[]) => skills.filter((s) => compSkills.has(String(s).toLowerCase()));
        const denom = Math.max(1, Math.min(compSkills.size, 4));
        const pct = (n: number) => (compSkills.size ? Math.min(100, Math.round((n / denom) * 100)) : 0);

        const { data: reqs } = await sb.from("talent_interest").select("kind, candidate_id, engineer_id").ilike("company", like);
        const reqCand = new Set((reqs ?? []).filter((r: any) => r.kind === "candidate").map((r: any) => r.candidate_id));
        const reqEng = new Set((reqs ?? []).filter((r: any) => r.kind === "profile").map((r: any) => r.engineer_id));

        const { data: cands } = await sb.from("candidates").select("id, initials, title, skills, rate_num").limit(2000);
        const candT: PortalTalent[] = (cands ?? []).map((c: any) => {
          const sk: string[] = c.skills ?? [];
          const m = ov(sk);
          return { ref: c.id, kind: "candidate", initials: (c.initials || "??").slice(0, 2), title: c.title ?? null, skills: sk, matchedSkills: m, rate: c.rate_num ? `¥${Math.round(c.rate_num)}万` : "応相談", matchPct: pct(m.length), requested: reqCand.has(c.id) };
        });

        let profT: PortalTalent[] = [];
        try {
          const pub = publicAdmin();
          const { data: profs } = await pub.from("profiles")
            .select("id, display_name, github_login, skills, primary_language, estimated_pay_low, estimated_pay_mid, estimated_pay_high")
            .or("github_id.not.is.null,github_login.not.is.null,display_name.not.is.null").limit(500);
          profT = (profs ?? []).map((p: any) => {
            const sk: string[] = Array.isArray(p.skills) ? p.skills.map((x: any) => x?.name).filter(Boolean) : [];
            const m = ov(sk);
            const rate = p.estimated_pay_low && p.estimated_pay_high ? `¥${p.estimated_pay_low}〜${p.estimated_pay_high}万` : p.estimated_pay_mid ? `¥${p.estimated_pay_mid}万` : "—";
            return { ref: p.id, kind: "profile", initials: String(p.display_name || p.github_login || "EN").slice(0, 2), title: p.primary_language ?? "エンジニア", skills: sk, matchedSkills: m, rate, matchPct: pct(m.length), requested: reqEng.has(p.id) };
          });
        } catch { /* profiles未取得は無視 */ }

        talent = [...candT, ...profT]
          .filter((t) => t.matchedSkills.length > 0 || compSkills.size === 0)
          .sort((a, b) => b.matchPct - a.matchPct || b.matchedSkills.length - a.matchedSkills.length)
          .slice(0, 12);
      } catch { /* おすすめ人材の取得失敗は無視 */ }
    } catch {
      note = "データの取得に失敗しました。時間をおいて再度お試しください。";
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">おすすめ人材 · {companyName ?? "—"}</div>
          <h1>ご提案中の人材</h1>
          <div className="sub">貴社の案件にマッチした人材です。マッチ度と一致スキルをご確認のうえ、「会いたい / 検討中 / ミスマッチ」でご評価ください。評価はミスマッチ低減に活用します。</div>
        </div>
      </div>

      {note && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13, marginBottom: 14 }}>{note}</div>}

      {/* おすすめ人材（匿名マッチ）：自社案件に合う人材を匿名で表示し、話を聞きたい→担当が仲介 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 2px 12px" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>おすすめ人材（マッチ）</h3>
        <span className="muted" style={{ fontSize: 11.5 }}>氏名・連絡先は伏せています。「話を聞きたい」で担当が仲介します。</span>
      </div>
      <PortalTalentList talent={talent} />

      <div style={{ margin: "26px 2px 12px" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>ご提案中の人材</h3>
      </div>
      <CandidateRecommendations items={items} />
    </div>
  );
}
