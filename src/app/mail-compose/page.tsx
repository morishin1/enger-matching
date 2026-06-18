import { notFound } from "next/navigation";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { MailComposeWizard } from "@/components/MailComposeWizard";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getStaff } from "@/lib/staff";
import { FlowSteps } from "@/components/FlowSteps";

export const dynamic = "force-dynamic";

export default async function MailComposePage({
  searchParams,
}: {
  searchParams: Promise<{ job_no?: string; cand_no?: string; score?: string }>;
}) {
  const sp = await searchParams;
  const jobNo = sp.job_no ? Number(sp.job_no) : null;
  const candNo = sp.cand_no ? Number(sp.cand_no) : null;
  const score = sp.score ? Math.round(Number(sp.score)) : 0;

  if (!jobNo || !candNo || !dbConfigured) return notFound();

  const sb = engerClient();
  const JOB =
    "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, contact_email, contact_name, source_mail_url, work_location, start_date";
  // contact_name は candidates テーブルには存在せず attachCompanyContact で動的付与されるため除外
  const CAND =
    "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, skills, salary_min, salary_max, remote_pref, exp, rate, avail, location, note, source_mail_url, source_mail_subject, email, contact_email, skill_sheet_url";

  // JOB は fallback 付き（contact_name / source_mail_url が無い古いスキーマに対応）
  let jr: any = await sb.from("jobs").select(JOB).eq("job_no", jobNo).maybeSingle();
  if (jr.error) jr = await sb.from("jobs").select("id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, contact_email, contact_name, work_location, start_date").eq("job_no", jobNo).maybeSingle();

  let cr: any = await sb.from("candidates").select(CAND).eq("candidate_no", candNo).maybeSingle();
  // source_mail_subject 列が未マイグレ環境向けの中間フォールバック
  if (cr.error) cr = await sb.from("candidates").select("id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, skills, salary_min, salary_max, remote_pref, exp, rate, avail, location, note, source_mail_url, email, contact_email, skill_sheet_url").eq("candidate_no", candNo).maybeSingle();
  if (cr.error) cr = await sb.from("candidates").select("id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, skills, salary_min, salary_max, remote_pref, exp, rate, avail, location, email, contact_email").eq("candidate_no", candNo).maybeSingle();

  if (!jr.data || !cr.data) return notFound();

  // source_mail_subject が未保存の人材（古い取込）向けに、source_mail_url から
  // inbox_emails.subject を取り直してメモリ上で補完する（DBは更新しない・読み取りのみ）。
  try {
    if (cr.data && !cr.data.source_mail_subject && typeof cr.data.source_mail_url === "string") {
      const m = cr.data.source_mail_url.match(/[/#]([A-Za-z0-9]{16,})(?:[/?]|$)/);
      const gmailId = m?.[1] ?? null;
      if (gmailId) {
        const ix: any = await sb.from("inbox_emails").select("subject").eq("gmail_message_id", gmailId).maybeSingle();
        if (ix?.data?.subject) (cr.data as any).source_mail_subject = ix.data.subject;
      }
    }
  } catch { /* inbox_emails 参照失敗時は固定件名にフォールバック */ }

  // 案件先担当者を CC へ自動反映するため、企業マスタの窓口メールを案件に付与する
  //   （案件の contact_email＝案件窓口 と併せて CC に入れ、案件確認の認識ズレを防ぐ）。
  try {
    if (jr.data.client_name) {
      const co: any = await sb.from("companies").select("contact_email").ilike("name", jr.data.client_name).maybeSingle();
      if (co.data?.contact_email) (jr.data as any).company_contact_email = co.data.contact_email;
    }
  } catch { /* companies 未整備でも続行 */ }

  // 既存の提案があれば step 2（確認画面）から開始して「保存済み」状態にする。
  //   approval_status も取得：承認済みなら提案者本人もこの画面から送信できるようにする（要件4）。
  //   pending_mail（下書き）も取得：差戻し後などに以前作成したメール内容を復元・編集できるようにする。
  let existingProposalId: string | null = null;
  let existingProposer: string | null = null;
  let existingApprovalStatus: string | null = null;
  let existingDraft: any = null;
  try {
    let pr: any = await sb
      .from("proposals")
      .select("id, proposer, approval_status, pending_mail")
      .eq("job_id", jr.data.id)
      .eq("candidate_id", cr.data.id)
      .maybeSingle();
    if (pr.error && /pending_mail|approval_status|column/i.test(pr.error.message ?? "")) {
      pr = await sb.from("proposals").select("id, proposer").eq("job_id", jr.data.id).eq("candidate_id", cr.data.id).maybeSingle();
    }
    existingProposalId = pr.data?.id ?? null;
    existingProposer = pr.data?.proposer ?? null;
    existingApprovalStatus = (pr.data as any)?.approval_status ?? null;
    existingDraft = (pr.data as any)?.pending_mail ?? null;
  } catch { /* proposals テーブル未整備でも続行 */ }

  // 承認者プルダウンの選択肢（社内メンバー）
  const [po, staffData] = await Promise.all([loadProposalOwners(), getStaff()]);
  const members: string[] = (po?.proposers && po.proposers.length > 0) ? po.proposers : staffData.members;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">Mail Compose</div>
          <h1>メール作成</h1>
        </div>
      </div>

      <FlowSteps current="proposals" sub="提案メール作成（案件×人材）" />

      <MailComposeWizard
        job={jr.data} cand={cr.data} score={score}
        initialSaved={!!existingProposalId}
        initialSavedId={existingProposalId}
        initialProposer={existingProposer}
        initialApprovalStatus={existingApprovalStatus}
        initialDraft={existingDraft}
        members={members}
      />
    </div>
  );
}
