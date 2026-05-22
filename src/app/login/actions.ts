"use server";

import { redirect } from "next/navigation";
import { authServerClient } from "@/lib/supabase-auth";
import { isAllowedEmail } from "@/lib/staff";

export type LoginState = { error?: string } | null;

/** メール+パスワードでログイン。staff.email に許可リストがあればそれで制限。 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/") || "/";
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください" };

  const supabase = await authServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "メールアドレスまたはパスワードが正しくありません" };

  // 許可リスト（担当者マスタの email）チェック
  if (!(await isAllowedEmail(email))) {
    await supabase.auth.signOut();
    return { error: "このアカウントには dx へのアクセス権限がありません（管理者に担当者登録を依頼してください）" };
  }

  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
