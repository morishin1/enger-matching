"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";

type Result = { ok: boolean; error?: string };

/** エンジニアへの対応を1件記録（誰が・いつ・何をしたか）。 */
export async function addEngineerAction(input: { engineer_id: string; engineer_name?: string | null; action: string; note?: string | null }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  if (!input.action?.trim()) return { ok: false, error: "対応内容が未選択です" };

  const access = await currentAccess();
  const operator = access?.name || access?.email || null;

  const { error } = await admin.from("engineer_actions").insert({
    engineer_id: input.engineer_id,
    engineer_name: input.engineer_name?.trim() || null,
    action: input.action.trim(),
    note: input.note?.trim() || null,
    operator,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/engineers");
  return { ok: true };
}

/** 対応履歴を1件削除（誤記録の取り消し）。 */
export async function deleteEngineerAction(id: string): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!id) return { ok: false, error: "IDが未指定です" };
  const { error } = await admin.from("engineer_actions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/engineers");
  return { ok: true };
}
