import { redirect } from "next/navigation";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { overlapSkills } from "@/lib/match";
import { getFeedbackMap } from "@/lib/client-feedback";
import { CandidateRecommendations, type RecoCandidate } from "@/components/CandidateRecommendations";

export const dynamic = "force-dynamic";

/** ユーザー企業(client)向け：自社案件に提案された人材を、マッチ度＋根拠つきで表示しFBを受ける。 */
export default async function PortalCandidatesPage() {
  const access = await currentAccess();
  if (access && access.role !== "client") redirect("/");

  const companyName = access?.companyName ?? null;
  let items: RecoCandidate[] = [];
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

      <CandidateRecommendations items={items} />
    </div>
  );
}
