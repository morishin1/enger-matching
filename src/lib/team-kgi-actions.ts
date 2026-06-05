"use server";

// チーム（部署）KGI 保存用の Server Action。権限チェック内蔵。
//   - admin: 全部署を編集可能
//   - manager/leader: 自部署のみ編集可能
//   - それ以外: 不可

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canManageDept } from "./roles";
import type { TeamKgiInput } from "./team-kgi";

/** KGIを upsert（department × month × metric で一意）。 */
export async function saveTeamKgi(input: TeamKgiInput): Promise<{ ok: boolean; error?: string }> {
  const access = await currentAccess();
  if (!access) return { ok: false, error: "ログインが必要です" };

  const isAdmin = access.role === "admin";
  const canMgr = canManageDept(access.teamRole) && access.department === input.department;
  if (!isAdmin && !canMgr) {
    return { ok: false, error: "権限がありません（管理者または該当部署のマネージャー/リーダーのみ編集可）" };
  }

  if (!input.department?.trim()) return { ok: false, error: "部署が未指定です" };
  if (!/^\d{4}-\d{2}-01$/.test(input.month)) return { ok: false, error: "月の指定が不正です（YYYY-MM-01）" };
  if (!["gross_profit_man", "active_engineers", "dropout"].includes(input.metric)) return { ok: false, error: "指標キーが不正です" };
  const min = input.target_min;
  const max = input.target_max;
  if (min != null && (Number.isNaN(min) || min < 0)) return { ok: false, error: "下限値が不正です" };
  if (max != null && (Number.isNaN(max) || max < 0)) return { ok: false, error: "上限値が不正です" };
  if (min != null && max != null && min > max) return { ok: false, error: "下限値が上限値を超えています" };

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const row = {
    department: input.department.trim(),
    month: input.month,
    metric: input.metric,
    target_min: min,
    target_max: max,
    note: input.note ?? null,
    updated_by_email: access.email || null,
    updated_by_name: access.name || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("team_kgi").upsert(row, { onConflict: "department,month,metric" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/team-kgi");
  revalidatePath("/");
  return { ok: true };
}
