"use server";

import { redirect } from "next/navigation";
import { authServerClient } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { isDxBlockedRole, DX_BLOCKED_MESSAGE } from "@/lib/roles";
import { hasFreelanceProfile } from "@/lib/auth-apps";

export type LoginState = { error?: string } | null;

/** メール+パスワードでログイン。アカウントの role/status を確認して入室。 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/") || "/";
  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください" };

  const supabase = await authServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // #407：営業アカウントが「時々ログインできない」事象の原因切り分けのため、実際の失敗理由を
    //   サーバログに残す（本文はユーザーに晒さない）。次回発生時に Vercel ログで原因を特定できるようにする。
    const msg = String(error.message ?? "");
    const code = String((error as any)?.code ?? (error as any)?.status ?? "");
    console.error("[login] signInWithPassword failed", { email, code, message: msg });
    // #263 ログイン停止（Auth の ban）中は固定文言で遮断（要件どおり）。
    if (/banned/i.test(msg)) return { error: "このアカウントはログインできません" };
    // メール未確認：発行済みアカウントで起こると「パスワードは合っているのに入れない」原因になる。
    //   admin 側の再発行（メール認証リンク）で解消されるため、その旨を案内する。
    if (/email not confirmed|not confirmed|confirm/i.test(msg)) {
      return { error: "メールアドレスの確認が完了していないためログインできません。管理者にアカウントの再発行（パスワード再設定）を依頼してください。" };
    }
    // レート制限：短時間に試行が集中したときの一時的な遮断。時間をおけば回復する。
    if (/rate|too many|429/i.test(msg + code)) {
      return { error: "ログイン試行が一時的に制限されています。少し時間をおいてから、もう一度お試しください。" };
    }
    return { error: "メールアドレスまたはパスワードが正しくありません" };
  }

  // アカウント(role/status)チェック
  const access = await resolveAccess(email);
  if (!access) {
    await supabase.auth.signOut();
    // 原因がわかるようメッセージを出し分け：フリーランス（profiles）として登録済みのメールなら明示する。
    if (await hasFreelanceProfile(email)) {
      return { error: "このメールアドレスは ENGERフリーランス（個人）として登録されています。フリーランスの方は enger.jp からログインしてください。ビジネス利用は「新規登録」から申請してください（管理者の承認後にログインできます）。" };
    }
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
