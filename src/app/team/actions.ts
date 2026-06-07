"use server";

// マネージャー/管理者が部下にメッセージを送るためのサーバーアクション。
//   notifications テーブルに追加して「お知らせ」に届ける。
//   送信権限：admin、または受信者が自部署に属するマネージャー/リーダー。

import { revalidatePath } from "next/cache";
import { engerAdmin } from "@/lib/supabase";
import { currentAccess, listDepartmentMemberNames } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";

type Result = { ok: boolean; error?: string };

async function canMessageMember(access: Awaited<ReturnType<typeof currentAccess>>, recipient: string): Promise<boolean> {
  if (!access) return true; // 認証未設定(ローカル)は許可
  if (access.role === "admin") return true;
  if (canManageDept(access.teamRole) && access.department) {
    const members = await listDepartmentMemberNames(access.department);
    return members.includes(recipient);
  }
  return false;
}

/** 部下の氏名と本文を受け取り、お知らせを送信。 */
export async function sendMemberMessage(recipient: string, message: string, kind: string = "manager_message"): Promise<Result> {
  const access = await currentAccess();
  const r = (recipient ?? "").trim();
  const m = (message ?? "").trim();
  if (!r) return { ok: false, error: "宛先（部下の氏名）が指定されていません" };
  if (!m) return { ok: false, error: "メッセージが空です" };
  if (m.length > 2000) return { ok: false, error: "メッセージが長すぎます（2000文字以内）" };
  if (!(await canMessageMember(access, r))) return { ok: false, error: "この相手にメッセージを送る権限がありません" };

  const sender = access?.name?.trim() || "管理者";
  const title = `${sender} さんからメッセージ`;
  const body = `${m}\n\n— ${sender}`;
  try {
    const admin = engerAdmin();
    const { error } = await admin.from("notifications").insert({ recipient: r, title, body, kind });
    if (error) return { ok: false, error: error.message };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
  revalidatePath("/notifications");
  return { ok: true };
}
