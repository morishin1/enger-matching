"use server";

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";

type Result = { ok: boolean; error?: string };

/** ステージ別の担当者目標を保存（admin / マネージャー・リーダーのみ）。
 *  どの環境でも確実に保存できるよう update→insert→（重複時）update の順に試し、
 *  例外は握って必ず Result を返す（クライアントは toast にメッセージを出すだけにする）。 */
export async function saveStageTarget(input: { owner_name: string; stage: string; target: number }): Promise<Result> {
  try {
    const access = await currentAccess();
    const allowed = !access || access.role === "admin" || canManageDept(access.teamRole ?? null);
    if (!allowed) return { ok: false, error: "目標を編集する権限がありません" };
    const owner = input.owner_name?.trim();
    const stage = input.stage?.trim();
    if (!owner || !stage) return { ok: false, error: "担当者・ステージが未指定です" };
    const target = Math.max(0, Math.floor(Number(input.target) || 0));
    let admin: ReturnType<typeof engerAdmin>;
    try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }
    const updated_by = access?.name ?? access?.email ?? null;
    const now = new Date().toISOString();
    // 「テーブル未作成」は本当に relation が無い場合のみに限定（テーブル名を含むだけの一般エラーを誤検出しない）。
    const tableMissing = (msg?: string) => /stage_targets.*does not exist|could not find the table[^]*stage_targets|relation .*stage_targets.* does not exist/i.test(msg ?? "");
    const isAuxColMissing = (msg?: string) => /updated_by|updated_at|could not find the '.*' column|schema cache/i.test(msg ?? "");

    // 1) UPDATE（補助列が無い環境では target のみで再試行）。
    const tryUpdate = async () => {
      let r: any = await admin.from("stage_targets").update({ target, updated_by, updated_at: now })
        .eq("owner_name", owner).eq("stage", stage).select("owner_name");
      if (r.error && isAuxColMissing(r.error.message)) {
        r = await admin.from("stage_targets").update({ target }).eq("owner_name", owner).eq("stage", stage).select("owner_name");
      }
      return r;
    };
    let upd = await tryUpdate();
    if (upd.error) {
      if (tableMissing(upd.error.message)) return { ok: false, error: "ステージ目標テーブル未作成です。supabase/stage-targets.sql を実行してください。" };
      return { ok: false, error: `保存に失敗しました：${upd.error.message}` };
    }
    if (Array.isArray(upd.data) && upd.data.length > 0) { revalidatePath("/proposals"); return { ok: true }; }

    // 2) 既存なし → INSERT（補助列が無い環境では target のみ）。
    let ins: any = await admin.from("stage_targets").insert({ owner_name: owner, stage, target, updated_by, updated_at: now });
    if (ins.error && isAuxColMissing(ins.error.message)) {
      ins = await admin.from("stage_targets").insert({ owner_name: owner, stage, target });
    }
    // 3) 主キー競合（並行・直前にINSERT済み等）なら UPDATE で確定。
    if (ins.error && /duplicate key|already exists|unique constraint|conflict/i.test(ins.error.message ?? "")) {
      const again = await tryUpdate();
      if (!again.error) { revalidatePath("/proposals"); return { ok: true }; }
      ins = again;
    }
    if (ins.error) {
      if (tableMissing(ins.error.message)) return { ok: false, error: "ステージ目標テーブル未作成です。supabase/stage-targets.sql を実行してください。" };
      return { ok: false, error: `保存に失敗しました：${ins.error.message}` };
    }
    revalidatePath("/proposals");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `保存に失敗しました：${e instanceof Error ? e.message : String(e)}` };
  }
}
