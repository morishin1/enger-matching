import { redirect } from "next/navigation";
import { engerClient, engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { MeetingGateBanner } from "@/components/MeetingGateBanner";
import { PortalSelectionView, type SelectionItem, type AiInterview } from "@/components/PortalSelectionView";
import { getFeedbackMap } from "@/lib/client-feedback";
import { AgentReferralButton } from "@/components/AgentReferralButton";

export const dynamic = "force-dynamic";

// docs/business-dashboard-v2-仕様.md §3「候補者・応募者（全媒体一括管理）」。
//   経路（エージェント提案／LINE／直接応募 等）を問わず、自社案件に来た人材を1画面に集約する。
//   データ源は proposals（LP応募も DBトリガ applications-to-proposals.sql で proposals にミラーされる）。
//   企業に見せる人材情報は常に匿名（イニシャル＋スキル＋単価。氏名/連絡先は担当が仲介）。

// proposals の各行から企業向けの「経路（source）」キーを導出する。
//   媒体（Indeed/エン転職 等）は §7 Phase2 で source が付与され次第、そのまま分類される。
function deriveRouteKey(p: any): string {
  const src = String(p.source ?? "").toLowerCase();
  if (src === "indeed") return "indeed";
  if (src === "en" || src === "en_tenshoku" || src.includes("tenshoku")) return "en";
  if (src === "line" || src === "line_works") return "line";
  // LP（enger.jp）からの直接応募は lp_direct / next_action で判定（エージェント提案と区別）。
  if (p.lp_direct === true || String(p.next_action ?? "").includes("直接応募")) return "direct";
  return "agent"; // 既定＝エージェント提案
}

/** ユーザー企業(client)向け：自社案件に来た候補者・応募者を全媒体一括で表示（匿名・ドロワー詳細）。 */
export default async function PortalSelectionPage() {
  const access = await currentAccess();
  if (access && access.role !== "client") redirect("/");

  if (access && !access.meetingDone) {
    return (
      <div className="page">
        <div className="page-head"><div><div className="meta">候補者・応募者</div><h1>候補者・応募者</h1></div></div>
        <MeetingGateBanner title="候補者・応募者の閲覧は担当との面談後に解放されます" description="応募者・選考ステージは、面談で利用方針を確認した後にご覧いただけます。" />
      </div>
    );
  }

  const companyName = access?.companyName ?? null;
  let items: SelectionItem[] = [];
  let jobOptions: { id: string; title: string }[] = [];
  let note: string | null = null;

  if (!companyName) {
    note = "アカウントに会社名が未設定です。管理者に会社名の登録を依頼してください。";
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${companyName}%`;
      // 匿名ホワイトリスト：氏名(candidate_name)・連絡先は取得しない（公開API /api/public/proposals と同方針）。
      const base = "id, job_id, candidate_id, job_title, c_init, rate, score, stage, source, lp_direct, next_action, created_at, stage_updated_at";
      let r: any = await sb.from("proposals").select(base).ilike("company", like).order("created_at", { ascending: false }).limit(300);
      if (r.error) r = await sb.from("proposals").select("id, job_id, candidate_id, job_title, c_init, rate, stage, source, created_at").ilike("company", like).order("created_at", { ascending: false }).limit(300);
      const rows = (r.error ? [] : (r.data ?? [])) as any[];

      // ドロワー用の匿名プロフィール（スキル・職種・経験・リモート・稼働・年代・国籍）。
      const candIds = Array.from(new Set(rows.map((p) => p.candidate_id).filter(Boolean)));
      const candById = new Map<string, any>();
      if (candIds.length) {
        let cr: any = await sb.from("candidates").select("id, initials, title, skills, exp, remote_pref, avail, age_band, nationality").in("id", candIds).limit(1000);
        if (cr.error) cr = await sb.from("candidates").select("id, initials, title, skills").in("id", candIds).limit(1000);
        for (const c of (cr?.data ?? []) as any[]) candById.set(c.id, c);
      }

      // 企業フィードバック（会いたい/検討中/ミスマッチ）を併読（一覧バッジ＋ドロワーの既回答）。
      //   candidates ページと同じく getFeedbackMap（admin 経由）で取得し RLS 差異の影響を避ける。
      const fbMap = await getFeedbackMap(rows.map((p) => p.id));

      // AI面接の依頼・結果（§5 Phase B）。admin 経由で proposal_id ごとに併読。テーブル未整備なら無視。
      const aiByProposal = new Map<string, AiInterview>();
      try {
        const ids = rows.map((p) => p.id);
        if (ids.length) {
          const ar: any = await engerAdmin().from("ai_interviews").select("proposal_id, status, score, report_url, video_url, summary").in("proposal_id", ids).limit(1000);
          for (const a of (ar?.data ?? []) as any[]) {
            aiByProposal.set(a.proposal_id, { status: a.status ?? null, score: a.score ?? null, reportUrl: a.report_url ?? null, videoUrl: a.video_url ?? null, summary: a.summary ?? null });
          }
        }
      } catch { /* ai_interviews 未整備でも続行 */ }

      const jobTitleById = new Map<string, string>();
      items = rows.map((p) => {
        const c = p.candidate_id ? candById.get(p.candidate_id) : null;
        const fb = fbMap[p.id] ?? null;
        const jobTitle = p.job_title ?? null;
        if (p.job_id && jobTitle) jobTitleById.set(String(p.job_id), jobTitle);
        return {
          id: p.id,
          jobId: p.job_id ? String(p.job_id) : null,
          jobTitle,
          stage: p.stage ?? null,
          routeKey: deriveRouteKey(p),
          createdAt: p.created_at ?? null,
          stageUpdatedAt: p.stage_updated_at ?? null,
          initials: c?.initials ?? p.c_init ?? null,
          title: c?.title ?? null,
          skills: Array.isArray(c?.skills) ? c.skills : [],
          rate: p.rate ?? null,
          exp: c?.exp ?? null,
          remotePref: c?.remote_pref ?? null,
          avail: c?.avail ?? null,
          ageBand: c?.age_band ?? null,
          nationality: c?.nationality ?? null,
          score: p.score ?? null,
          verdict: fb?.verdict ?? null,
          reason: fb?.reason ?? null,
          aiInterview: aiByProposal.get(p.id) ?? null,
        } as SelectionItem;
      });
      jobOptions = Array.from(jobTitleById.entries()).map(([id, title]) => ({ id, title }));
    } catch { note = "データの取得に失敗しました。"; }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">候補者・応募者 · {companyName ?? "—"}</div>
          <h1>候補者・応募者</h1>
          <div className="sub">エージェント提案・応募・LINE など、経路を問わず自社案件に来た人材を一括表示します。氏名はイニシャル表示です。面談調整・実名確認は担当エージェントが仲介します。</div>
        </div>
        {!note && <AgentReferralButton />}
      </div>

      {note ? (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>{note}</div>
      ) : (
        <PortalSelectionView items={items} companyName={companyName} jobOptions={jobOptions} aiInterviewEnabled={access?.aiInterview ?? false} />
      )}
    </div>
  );
}
