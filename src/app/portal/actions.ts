"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import type { Verdict } from "@/lib/client-feedback";

type Result = { ok: boolean; error?: string };

export const CONTRACT_TYPES = ["SES", "紹介", "派遣"] as const;

/** 企業が自社案件を掲載（下書き→審査中）。client のみ。承認後に公開される。 */
export async function createClientJob(input: {
  title: string; role_label?: string; skills?: string[]; salary_min?: number | null; salary_max?: number | null;
  remote_type?: string; contract_types?: string[]; description?: string;
}): Promise<Result> {
  const access = await currentAccess();
  if (!access || access.role !== "client") return { ok: false, error: "権限がありません" };
  if (!access.companyName) return { ok: false, error: "会社名が未設定です。管理者にご連絡ください。" };
  if (!input.title?.trim()) return { ok: false, error: "案件名を入力してください" };

  try {
    const sb = engerAdmin();
    // job_no は連番。最大値+1。
    const { data: maxRow } = await sb.from("jobs").select("job_no").order("job_no", { ascending: false }).limit(1).maybeSingle();
    const nextNo = (Number((maxRow as any)?.job_no) || 0) + 1;
    const cts = (input.contract_types ?? []).filter((c) => (CONTRACT_TYPES as readonly string[]).includes(c));

    const { error } = await sb.from("jobs").insert({
      job_no: nextNo,
      title: input.title.trim(),
      client_name: access.companyName,
      role_label: input.role_label?.trim() || null,
      skills: input.skills ?? [],
      salary_min: input.salary_min ?? null,
      salary_max: input.salary_max ?? null,
      remote_type: input.remote_type || null,
      contract_types: cts,
      description: input.description?.trim() || null,
      posted_by_client: true,
      posted_by_email: access.email || null,
      review_status: "pending",
      status: "審査中",
      is_published: false,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/portal/jobs");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
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
