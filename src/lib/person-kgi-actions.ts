"use server";

// 個人月次KGI 保存用 Server Action。権限チェック内蔵。
//   - admin: 全員を編集可能
//   - manager/leader: 自部署メンバーのみ編集可能
//   - それ以外: 不可

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess, getAccountByEmail } from "./accounts";
import { canManageDept } from "./roles";
import type { PersonKgiInput } from "./person-kgi";

export async function savePersonKgi(input: PersonKgiInput): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "ログインが必要です" };

  const targetEmail = (input.owner_email || "").toLowerCase().trim();
  if (!targetEmail) return { ok: false, error: "対象メンバーが未指定です" };
  if (!/^\d{4}-\d{2}-01$/.test(input.month)) return { ok: false, error: "月の指定が不正です（YYYY-MM-01）" };
  if (input.placement_target != null && (Number.isNaN(input.placement_target) || input.placement_target < 0)) {
    return { ok: false, error: "稼働化目標は0以上の数値で入力してください" };
  }

  // 対象メンバーの部署を取得
  const target = await getAccountByEmail(targetEmail);
  if (!target) return { ok: false, error: "対象メンバーがアカウントマスタに存在しません" };

  const isAdmin = access.role === "admin";
  const canMgr = canManageDept(access.teamRole) && !!access.department && (target as any).department === access.department;
  if (!isAdmin && !canMgr) {
    return { ok: false, error: "権限がありません（管理者または対象メンバーが所属する部署のマネージャー/リーダーのみ編集可）" };
  }

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const row = {
    owner_email: targetEmail,
    owner_name: target.name ?? input.owner_name ?? null,
    department: (target as any).department ?? input.department ?? null,
    month: input.month,
    placement_target: input.placement_target,
    note: input.note ?? null,
    updated_by_email: access.email || null,
    updated_by_name: access.name || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("person_kgi").upsert(row, { onConflict: "owner_email,month" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/person-kgi");
  revalidatePath("/reports");
  revalidatePath("/");
  return { ok: true };
}
