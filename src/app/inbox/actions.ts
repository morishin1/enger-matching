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

/** お問い合わせを1件削除（営業/管理者）。スパム・テストデータの除去に使用。 */
export async function deleteContactMessage(id: string): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  if (!id) return { ok: false, error: "id がありません" };
  try {
    const sb = engerAdmin();
    const { error } = await sb.from("contact_messages").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}

/** お問い合わせを複数件まとめて削除（管理者のみ・ジャンク一括除去用）。 */
export async function deleteContactMessages(ids: string[]): Promise<Result & { deleted?: number }> {
  const access = await currentAccess();
  if (!access || access.role !== "admin") return { ok: false, error: "一括削除は管理者のみ可能です" };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: "削除対象がありません" };
  try {
    const sb = engerAdmin();
    const { error, count } = await sb.from("contact_messages").delete({ count: "exact" }).in("id", ids);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/inbox");
    return { ok: true, deleted: count ?? ids.length };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
