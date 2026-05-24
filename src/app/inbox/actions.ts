"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

type Result = { ok: boolean; error?: string };

/** お問い合わせの対応状況を更新（営業/管理者）。 */
export async function updateContactStatus(id: string, status: "new" | "inprogress" | "done"): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  if (!["new", "inprogress", "done"].includes(status)) return { ok: false, error: "不正なステータスです" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("contact_messages").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
