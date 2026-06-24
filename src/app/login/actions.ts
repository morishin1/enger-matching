"use server";

import { redirect } from "next/navigation";
import { authServerClient } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { isDxBlockedRole, DX_BLOCKED_MESSAGE } from "@/lib/roles";

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
  // フリーランス（人材）は法人ログイン不可。Auth を LP と共有しているため、
  //   サインインに成功してもここでセッションを破棄して締め出す。
  if (isDxBlockedRole(access.role)) {
    await supabase.auth.signOut();
    return { error: DX_BLOCKED_MESSAGE };
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

export type ResetState = { ok?: boolean; error?: string } | null;

/** パスワード再設定メールを送信。存在の有無は明かさず常に成功扱い（列挙防止）。 */
export async function requestPasswordReset(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "メールアドレスの形式が正しくありません" };
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");
  try {
    const supabase = await authServerClient();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${site}/api/auth/callback?next=/reset-password` });
  } catch { /* エラー内容も明かさない */ }
  return { ok: true };
}

/** メールのリンクから入った状態で新しいパスワードを設定。 */
export async function updatePassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const pw = String(formData.get("password") ?? "");
  const pw2 = String(formData.get("password2") ?? "");
  if (pw.length < 8) return { error: "パスワードは8文字以上で入力してください" };
  if (pw !== pw2) return { error: "確認用パスワードが一致しません" };
  try {
    const supabase = await authServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "リンクの有効期限が切れています。お手数ですが、もう一度「パスワードを忘れた方」からやり直してください。" };
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e: any) { return { error: String(e?.message ?? e) }; }
}
