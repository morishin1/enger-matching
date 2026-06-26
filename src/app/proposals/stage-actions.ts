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
  const updated_by = access?.name ?? access?.email ?? null;
  const now = new Date().toISOString();
  const tableMissing = (msg: string) => /relation .*does not exist|could not find the table|schema cache|stage_targets/i.test(msg ?? "");

  // onConflict 制約（owner_name,stage の一意制約）に依存せず、update→無ければinsert で確実に保存する。
  //   旧環境で主キー/一意制約が無いと upsert(onConflict) が
  //   「no unique or exclusion constraint matching」で失敗していたため。
  let upd: any = await admin.from("stage_targets").update({ target, updated_by, updated_at: now })
    .eq("owner_name", owner).eq("stage", stage).select("owner_name");
  if (upd.error && /updated_by|updated_at|column/i.test(upd.error.message ?? "")) {
    // 補助列が無い環境では target のみ更新。
    upd = await admin.from("stage_targets").update({ target }).eq("owner_name", owner).eq("stage", stage).select("owner_name");
  }
  if (upd.error) {
    if (tableMissing(upd.error.message)) return { ok: false, error: "ステージ目標テーブル未作成です。supabase/stage-targets.sql を実行してください。" };
    return { ok: false, error: upd.error.message };
  }
  if (Array.isArray(upd.data) && upd.data.length > 0) { revalidatePath("/proposals"); return { ok: true }; }

  // 既存なし → 新規挿入。
  let ins: any = await admin.from("stage_targets").insert({ owner_name: owner, stage, target, updated_by, updated_at: now });
  if (ins.error && /updated_by|updated_at|column/i.test(ins.error.message ?? "")) {
    ins = await admin.from("stage_targets").insert({ owner_name: owner, stage, target });
  }
  if (ins.error) {
    if (tableMissing(ins.error.message)) return { ok: false, error: "ステージ目標テーブル未作成です。supabase/stage-targets.sql を実行してください。" };
    return { ok: false, error: ins.error.message };
  }
  revalidatePath("/proposals");
  return { ok: true };
}
