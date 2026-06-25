"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";

type Result = { ok: boolean; error?: string };

/** ステージ別の担当者目標を保存（admin / マネージャー・リーダーのみ）。 */
export async function saveStageTarget(input: { owner_name: string; stage: string; target: number }): Promise<Result> {
  const access = await currentAccess();
  const allowed = !access || access.role === "admin" || canManageDept(access.teamRole ?? null);
  if (!allowed) return { ok: false, error: "目標を編集する権限がありません" };
  const owner = input.owner_name?.trim();
  const stage = input.stage?.trim();
  if (!owner || !stage) return { ok: false, error: "担当者・ステージが未指定です" };
  const target = Math.max(0, Math.floor(Number(input.target) || 0));
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY 未設定" }; }
  const { error } = await admin.from("stage_targets").upsert(
    { owner_name: owner, stage, target, updated_by: access?.name ?? access?.email ?? null, updated_at: new Date().toISOString() },
    { onConflict: "owner_name,stage" },
  );
  if (error) {
    if (/stage_targets|relation|column/i.test(error.message)) return { ok: false, error: "ステージ目標テーブル未作成です。supabase/stage-targets.sql を実行してください。" };
    return { ok: false, error: error.message };
  }
  revalidatePath("/proposals");
  return { ok: true };
}
