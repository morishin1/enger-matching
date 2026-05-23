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

/** エンジニアへスカウトを送る。対応履歴にも「スカウト送信」を自動記録。 */
export async function sendScout(input: { engineer_id: string; engineer_name?: string | null; job_title?: string | null; message: string }): Promise<Result> {
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  if (!input.engineer_id) return { ok: false, error: "対象エンジニアが未指定です" };
  if (!input.message?.trim()) return { ok: false, error: "スカウト本文が空です" };

  const access = await currentAccess();
  const agent = access?.name || access?.email || null;
  const engineer_name = input.engineer_name?.trim() || null;
  const job_title = input.job_title?.trim() || null;

  const { error } = await admin.from("scouts").insert({
    engineer_id: input.engineer_id,
    engineer_name,
    agent,
    job_title,
    message: input.message.trim(),
    status: "sent",
  });
  if (error) return { ok: false, error: error.message };

  // 履歴にも残す（重複アプローチ防止・引き継ぎ）
  await admin.from("engineer_actions").insert({
    engineer_id: input.engineer_id,
    engineer_name,
    action: "スカウト送信",
    note: job_title ? `案件: ${job_title}` : null,
    operator: agent,
  });

  revalidatePath("/engineers");
  return { ok: true };
}

/** 応募の選考ステージを更新（営業/管理者）。応募→面談合格→稼働を追跡。 */
export async function updateApplicationStage(id: string, stage: string): Promise<Result> {
  const access = await currentAccess();
  if (!access || (access.role !== "admin" && access.role !== "agent")) return { ok: false, error: "権限がありません" };
  const allowed = ["応募", "書類選考", "面談", "面談合格", "稼働", "見送り"];
  if (!allowed.includes(stage)) return { ok: false, error: "不正なステージです" };
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { error } = await admin.from("applications").update({ stage, stage_updated_at: new Date().toISOString() }).eq("id", id);
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
