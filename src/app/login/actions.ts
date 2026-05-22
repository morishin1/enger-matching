"use server";

import { redirect } from "next/navigation";
import { authServerClient } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";

export type LoginState = { error?: string } | null;

/** メール+パスワードでログイン。アカウントの role/status を確認して入室。 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/") || "/";
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください" };

  const supabase = await authServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: "メールアドレスまたはパスワードが正しくありません" };

  // アカウント(role/status)チェック
  const access = await resolveAccess(email);
  if (!access) {
    await supabase.auth.signOut();
    return { error: "このアカウントには dx へのアクセス権限がありません（管理者に登録を依頼してください）" };
  }
  if (access.status === "pending") {
    await supabase.auth.signOut();
    return { error: "このアカウントは承認待ちです。管理者の承認後にログインできます。" };
  }
  if (access.status === "disabled") {
    await supabase.auth.signOut();
    return { error: "このアカウントは無効化されています。管理者にお問い合わせください。" };
  }

  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
