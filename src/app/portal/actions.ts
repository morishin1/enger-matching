"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { draftCompanyFromSource, draftCandidateFromText, sanitizeCandidateDraft, type CompanyDraft, type CandidateDraft } from "@/lib/business-ai";
import { insertClientJob } from "@/lib/client-jobs";
import type { Verdict } from "@/lib/client-feedback";
import { listReferralsByCompany, type ClientReferral } from "@/lib/client-referrals";
import { notifySlack, appUrl } from "@/lib/slack";

type Result = { ok: boolean; error?: string };

/** 会社サイトURL または 法人番号 から AI で企業プロフィール（Mission等）を下書き生成。client のみ。
 *  生成ロジックは enger-lp 向け公開API（/api/public/ai-draft）と共通（business-ai.ts）。 */
export async function draftCompanyProfileSmart(input: { website?: string; corporateNo?: string }): Promise<{ ok: boolean; error?: string; draft?: CompanyDraft }> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  const r = await draftCompanyFromSource({ website: input.website, corporateNo: input.corporateNo }, "company", access.email ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, draft: r.draft };
}

/** 旧シグネチャ互換（URLのみ）。draftCompanyProfileSmart へ委譲。 */
export async function draftCompanyProfileFromUrl(url: string): Promise<{ ok: boolean; error?: string; draft?: CompanyDraft }> {
  return draftCompanyProfileSmart({ website: url });
}

/** 企業が自社案件を掲載（下書き→審査中）。client のみ。承認後に公開される。
 *  登録コアは enger-lp 向け公開API（POST /api/public/jobs）と共通（client-jobs.ts）。 */
export async function createClientJob(input: {
  title: string; role_label?: string; skills?: string[]; salary_min?: number | null; salary_max?: number | null;
  remote_type?: string; contract_types?: string[]; description?: string;
}): Promise<Result> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  if (!access.companyName) return { ok: false, error: "会社名が未設定です。管理者にご連絡ください。" };
  const r = await insertClientJob(access.companyName, access.email || null, input);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath("/portal/jobs");
  return { ok: true };
}

/** 管理者/営業が企業掲載案件を承認（公開）または却下。 */
export async function reviewClientJob(jobNo: number | string, approve: boolean): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  try {
    const sb = engerAdmin();
    const patch = approve
      ? { review_status: "approved", is_published: true, status: "募集中", updated_at: new Date().toISOString() }
      : { review_status: "rejected", is_published: false, status: "却下", updated_at: new Date().toISOString() };
    const { error } = await sb.from("jobs").update(patch).eq("job_no", jobNo).eq("posted_by_client", true);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/jobs"); revalidatePath("/portal/jobs");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 企業が「おすすめ人材（匿名）」に話を聞きたい旨を申し込む。client のみ。営業が仲介。 */
export async function expressTalentInterest(input: { kind: "candidate" | "profile"; ref: string; label?: string }): Promise<Result> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  if (!access.companyName) return { ok: false, error: "会社名が未設定です。管理者にご連絡ください。" };
  if (!input.ref || (input.kind !== "candidate" && input.kind !== "profile")) return { ok: false, error: "入力が不正です" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("talent_interest").insert({
      company: access.companyName,
      kind: input.kind,
      candidate_id: input.kind === "candidate" ? input.ref : null,
      engineer_id: input.kind === "profile" ? input.ref : null,
      label: input.label?.slice(0, 80) ?? null,
      status: "new",
    });
    // 既に申込済み（unique制約違反）はエラー扱いしない
    if (error && !/duplicate|unique/i.test(error.message)) return { ok: false, error: error.message };
    revalidatePath("/portal/candidates");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 企業が自社プロフィール（Mission等）を保存。client のみ・自社のみ。 */
export async function saveCompanyProfile(input: { mission?: string; culture?: string; ideal_persona?: string; appeal?: string; website?: string }): Promise<Result> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  if (!access.companyName) return { ok: false, error: "会社名が未設定です。管理者にご連絡ください。" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("company_profiles").upsert({
      company: access.companyName,
      mission: input.mission?.trim() || null,
      culture: input.culture?.trim() || null,
      ideal_persona: input.ideal_persona?.trim() || null,
      appeal: input.appeal?.trim() || null,
      website: input.website?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal/company");
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 営業/管理者：企業からの人材リクエストの対応状況を更新（new/contacted/closed）。 */
export async function updateTalentRequestStatus(id: string, status: "new" | "contacted" | "closed"): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  if (!["new", "contacted", "closed"].includes(status)) return { ok: false, error: "不正なステータスです" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("talent_interest").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** 企業が提案人材へフィードバック（会いたい/検討中/ミスマッチ）。本人(client)のみ・自社提案のみ。 */
export async function submitClientFeedback(proposalId: string, verdict: Verdict, reason: string): Promise<Result> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  if (!proposalId || !["want", "maybe", "mismatch"].includes(verdict)) return { ok: false, error: "入力が不正です" };

  try {
    const sb = engerAdmin();
    // 自社の提案であることを確認（company 名寄せ）
    const { data: prop } = await sb.from("proposals").select("id, company").eq("id", proposalId).maybeSingle();
    if (!prop) return { ok: false, error: "提案が見つかりません" };
    const company = access.companyName ?? "";
    if (company && prop.company && !String(prop.company).includes(company) && !company.includes(String(prop.company))) {
      return { ok: false, error: "自社の提案ではありません" };
    }

    const { error } = await sb.from("client_feedback").upsert({
      proposal_id: proposalId,
      company: access.companyName ?? prop.company ?? null,
      verdict,
      reason: reason?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "proposal_id" });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/portal/candidates");
    revalidatePath("/");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

// ============================================================
// 「エージェントに紹介」モーダル（docs/business-dashboard-v2-仕様.md §4）。
//   人材マスタへの直接登録ではなく、まず紹介（enger.client_referrals）として受け取り、
//   エージェントが内容確認のうえ人材登録する。ロジックは公開API
//   （POST /api/public/candidate-referrals）と同じ sanitizeCandidateDraft を使い、
//   dx（社内認証セッション）経由でも同一の項目・保存先に統一する。
// ============================================================

/** 経歴テキストの貼り付け → AI下書き（イニシャル・職種・スキル等）。client のみ。 */
export async function draftCandidateReferralSmart(text: string): Promise<{ ok: boolean; error?: string; draft?: CandidateDraft }> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  const r = await draftCandidateFromText(text, "biz_cand_referral_dx", access.email ?? null);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, draft: r.draft };
}

/** 自社の紹介履歴＋対応状況（モーダル下部表示用）。client のみ。 */
export async function listMyCandidateReferrals(): Promise<ClientReferral[]> {
  const access = await currentAccess();
  if (!access || access.role !== "client" || !access.companyName) return [];
  return listReferralsByCompany(access.companyName);
}

/** エージェントに人材を紹介（送信）。client のみ。Slackで社内へ即時通知。 */
export async function submitCandidateReferral(input: {
  name?: string; initials?: string; title?: string; skills?: string[]; rate?: string;
  exp?: string; avail?: string; location?: string; note?: string;
}): Promise<Result> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  if (!access.companyName) return { ok: false, error: "会社名が未設定です。管理者にご連絡ください。" };

  const d = sanitizeCandidateDraft(input ?? {});
  const name = String(input?.name ?? "").trim().slice(0, 60) || null;
  const initials = d.initials?.trim() || (name ? `${name[0]}.` : "");
  if (!initials) return { ok: false, error: "イニシャル（または氏名）を入力してください" };
  if (!d.skills || d.skills.length === 0) return { ok: false, error: "スキルを1つ以上入力してください" };

  try {
    const sb = engerAdmin();
    const ins: any = await sb.from("client_referrals").insert({
      company: access.companyName,
      referred_by: access.email ?? null,
      name,
      initials,
      title: d.title ?? null,
      skills: d.skills,
      rate: d.rate ?? null,
      exp: d.exp ?? null,
      avail: d.avail ?? null,
      location: d.location ?? null,
      note: d.note ?? null,
      status: "new",
    }).select("id").maybeSingle();
    if (ins.error) {
      if (/client_referrals|relation|schema cache/i.test(ins.error.message ?? "")) {
        return { ok: false, error: "紹介テーブルが未整備です（supabase/client-referrals.sql を実行してください）" };
      }
      return { ok: false, error: ins.error.message };
    }

    try {
      await notifySlack({
        text: `🤝 企業からの人材紹介：${access.companyName} / ${initials}（${d.title ?? "職種未記入"}）`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*🤝 企業からの人材紹介が届きました*\n• 紹介元: *${access.companyName}*（${access.email}）\n• 人材: *${initials}*${d.title ? ` / ${d.title}` : ""}${d.rate ? ` / ${d.rate}` : ""}\n• スキル: ${d.skills.slice(0, 8).join(", ")}${d.note ? `\n• 補足: ${d.note.slice(0, 200)}` : ""}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: `内容を確認して <${appUrl("/people")}|人材管理> へ登録してください（登録後は client_referrals.status を registered に更新）` }] },
        ],
      });
    } catch { /* Slack 失敗は無視 */ }

    revalidatePath("/portal/selection");
    revalidatePath("/portal/jobs");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
