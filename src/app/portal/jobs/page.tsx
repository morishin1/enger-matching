import { redirect } from "next/navigation";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { PortalJobsList, type PortalJob } from "@/components/PortalJobsList";
import { ClientJobForm } from "@/components/ClientJobForm";
import { AgentReferralButton } from "@/components/AgentReferralButton";

export const dynamic = "force-dynamic";

/** ユーザー企業(client)向け：自社案件の一覧（検索・提案件数つき）。 */
export default async function PortalJobsPage() {
  const access = await currentAccess();
  // client 以外（営業/管理者）はここを使わない → ダッシュボードへ
  if (access && access.role !== "client") redirect("/");

  const companyName = access?.companyName ?? null;
  let jobs: PortalJob[] = [];
  let note: string | null = null;

  if (!companyName) {
    note = "アカウントに会社名が未設定です。管理者に会社名の登録を依頼してください。";
  } else if (dbConfigured) {
    try {
      const sb = engerClient();
      const like = `%${companyName}%`;
      const cols = "id, job_no, title, role_label, salary_min, salary_max, remote_type, status, skills, contract_types, review_status, is_published, posted_by_client";
      const [jr, pr] = await Promise.all([
        // 公開中の自社案件 + 自社が掲載した案件（審査中/却下含む）
        sb.from("jobs").select(cols)
          .ilike("client_name", like)
          .or("is_published.eq.true,posted_by_client.eq.true")
          .order("created_at", { ascending: false }).limit(300),
        sb.from("proposals").select("job_title, stage").ilike("company", like).limit(500),
      ]);
      const props = pr.data ?? [];
      const jobRows = (jr.data ?? []) as any[];
      // 各案件への応募（LP「応募する」経由 = enger.applications）を job_id で集計。
      //   企業ポータルでも案件カードに「応募 N人」を出し、選考管理へ誘導する。
      const jobIds = jobRows.map((j) => j.id).filter(Boolean);
      const appCount = new Map<string, number>();
      if (jobIds.length) {
        try {
          const ar: any = await sb.from("applications").select("job_id").in("job_id", jobIds).limit(2000);
          for (const a of (ar.data ?? [])) { const k = String(a.job_id); appCount.set(k, (appCount.get(k) ?? 0) + 1); }
        } catch { /* applications 未整備でも案件一覧は出す */ }
      }
      jobs = jobRows.map((j: any) => {
        const mine = props.filter((p: any) => (p.job_title ?? "") === (j.title ?? ""));
        const active = mine.filter((p: any) => p.stage !== "見送り" && p.stage !== "失注");
        return { ...j, proposalCount: mine.length, activeCount: active.length, applicantCount: appCount.get(String(j.id)) ?? 0 } as PortalJob;
      });
    } catch {
      note = "データの取得に失敗しました。時間をおいて再度お試しください。";
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">自社案件 · {companyName ?? "—"}</div>
          <h1>自社の案件</h1>
          <div className="sub">貴社で公開中の案件と、各案件へのご提案状況をご確認いただけます。</div>
        </div>
      </div>

      {note && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13, marginBottom: 14 }}>{note}</div>}

      <div style={{ marginBottom: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <ClientJobForm />
        {!note && <AgentReferralButton />}
      </div>

      <PortalJobsList jobs={jobs} />
    </div>
  );
}
