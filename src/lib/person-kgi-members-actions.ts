"use server";

// 個人KGI メンバー名簿の保存 Server Action（権限チェック内蔵）。
//   - admin: 全部署の名簿を編集可能
//   - manager/leader: 自部署の名簿のみ編集可能
//   - それ以外: 不可
// 名簿は app_settings(key='person_kgi_members') の { [department]: [{email,name}] } に upsert する。

import { revalidatePath } from "next/cache";
import { engerAdmin } from "./supabase";
import { currentAccess } from "./accounts";
import { canManageDept } from "./roles";
import {
  loadPersonKgiMembersBlob,
  normalizePersonKgiMembers,
  PERSON_KGI_MEMBERS_KEY,
  type PersonKgiMember,
} from "./person-kgi-members";

type Result = { ok: boolean; error?: string };

export async function savePersonKgiMembers(department: string, members: PersonKgiMember[]): Promise<Result> {
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin"; // ローカル(未認証)=admin相当
  const isManager = !!access && canManageDept(access.teamRole) && !!access.department && access.department === department;
  if (!isAdmin && !isManager) {
    return { ok: false, error: "権限がありません（管理者または対象部署のマネージャー/リーダーのみ編集可）" };
  }
  const dept = String(department ?? "").trim();
  if (!dept) return { ok: false, error: "部署が未指定です" };

  const clean = normalizePersonKgiMembers(members);

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return { ok: false, error: "サーバ設定エラー：SUPABASE_SERVICE_ROLE_KEY が未設定です" }; }

  // 既存ブロブへ対象部署だけ差し替えて保存（他部署の名簿は保持）。
  const blob = await loadPersonKgiMembersBlob();
  const next = { ...blob, [dept]: clean };
  const { error } = await admin.from("app_settings").upsert({ key: PERSON_KGI_MEMBERS_KEY, value: next }, { onConflict: "key" });
  if (error) {
    if (/app_settings|relation|column/i.test(error.message)) {
      return { ok: false, error: "app_settings テーブルが未整備です（supabase/app-settings.sql を実行してください）" };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath("/settings/person-kgi");
  return { ok: true };
}
