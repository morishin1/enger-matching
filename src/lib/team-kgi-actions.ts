"use server";

// チーム（部署）KGI 保存用の Server Action（稼働数ドリブン版）。権限チェック内蔵。
//   - admin: 全部署を編集可能
//   - manager/leader: 自部署のみ編集可能
//   - それ以外: 不可

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canManageDept } from "./roles";
import type { TeamKgiInput } from "./team-kgi";

const nonNeg = (n: number | null, label: string): string | null => {
  if (n == null) return null;
  if (Number.isNaN(n) || n < 0) return `${label}は0以上の数値で入力してください`;
  return null;
};

/** KGIを upsert（department × month で一意）。 */
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

  for (const [v, label] of [
    [input.active_current, "現在の稼働数"],
    [input.active_add, "増やす目標"],
    [input.rate_per_head_man, "1名あたり平均月額"],
    [input.gross_per_head_man, "1名あたり平均粗利"],
    [input.dropout_allowed, "許容離脱数"],
  ] as [number | null, string][]) {
    const err = nonNeg(v, label);
    if (err) return { ok: false, error: err };
  }

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  const row = {
    department: input.department.trim(),
    month: input.month,
    active_current: input.active_current,
    active_add: input.active_add,
    rate_per_head_man: input.rate_per_head_man,
    gross_per_head_man: input.gross_per_head_man,
    dropout_allowed: input.dropout_allowed,
    note: input.note ?? null,
    updated_by_email: access.email || null,
    updated_by_name: access.name || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("team_kgi").upsert(row, { onConflict: "department,month" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/team-kgi");
  revalidatePath("/");
  return { ok: true };
}
