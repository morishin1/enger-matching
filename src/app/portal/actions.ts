"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import type { Verdict } from "@/lib/client-feedback";

type Result = { ok: boolean; error?: string };

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
