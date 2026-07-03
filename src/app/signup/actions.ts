"use server";

import { headers } from "next/headers";
import { authServerClient } from "@/lib/supabase-auth";
import { createPendingAccount } from "@/lib/accounts";
import { markBusinessAuthApp } from "@/lib/auth-apps";
import {
  shouldBlockSignupAttempt, isValidEmail, isDisposableEmail,
  passwordStrengthError, isCommonPassword, sanitizeName, coerceSelfSignupRole,
} from "@/lib/signup-security";

export type SignupState = { error?: string; ok?: boolean } | null;

// クライアントIP取得（Vercel/プロキシ越し対応）。x-forwarded-for の先頭を採用、フォールバック多段。
async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip") ?? h.get("cf-connecting-ip") ?? "unknown";
}

/** 自己登録。Supabase にユーザー作成 → app_users を承認待ちで登録。管理者承認後にログイン可。
 *  セキュリティ：
 *    - パートナー企業の自己登録は不可（admin 招待制）
 *    - ハニーポット(website)、IP単位レート制限、入力検証、使い捨てメール拒否、弱パスワード拒否、利用規約同意必須 */
export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  // 1) ハニーポット：人間は触らない隠しフィールドが埋まっていればbot。即拒否（同じメッセージで詳細を隠す）
  const honeypot = String(formData.get("website") ?? "");
  if (honeypot) return { error: "登録できませんでした。時間をおいて再度お試しください。" };

  // 2) 利用規約・プライバシー同意
  const agree = formData.get("agree");
  if (!agree) return { error: "利用規約・プライバシーポリシーへの同意が必要です" };

  // 3) IP単位レート制限（1IPあたり 5回/時）
  const ip = await getClientIp();
  const rl = shouldBlockSignupAttempt(ip);
  if (rl.blocked) {
    const min = Math.ceil((rl.retryAfterSec ?? 60) / 60);
    return { error: `短時間に登録試行が多すぎます。約${min}分後にもう一度お試しください。` };
  }

  // 4) 入力取得＋検証
  const rawEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nameRes = sanitizeName(String(formData.get("name") ?? ""), { max: 50, label: "お名前" });
  if (!nameRes.ok) return { error: nameRes.error };
  const name = nameRes.value;

  // 自己登録ロール（partner/agent は不可）
  const role = coerceSelfSignupRole(formData.get("role"));

  // 会社名：client は必須、freelance は任意、candidate は受け取らない
  let company: string | null = null;
  if (role === "client") {
    const cr = sanitizeName(String(formData.get("company") ?? ""), { max: 100, label: "会社名" });
    if (!cr.ok) return { error: cr.error };
    company = cr.value;
  } else if (role === "freelance") {
    const v = String(formData.get("company") ?? "").trim();
    if (v) {
      const cr = sanitizeName(v, { max: 100, label: "屋号・会社名" });
      if (!cr.ok) return { error: cr.error };
      company = cr.value;
    }
  }

  if (!rawEmail) return { error: "メールアドレスを入力してください" };
  if (!isValidEmail(rawEmail)) return { error: "メールアドレスの形式が正しくありません" };
  if (isDisposableEmail(rawEmail)) return { error: "使い捨てのメールアドレスは登録できません。会社のメールアドレスをご使用ください。" };

  const pwErr = passwordStrengthError(password);
  if (pwErr) return { error: pwErr };
  if (isCommonPassword(password)) return { error: "推測されやすいパスワードです。別の文字列を設定してください。" };

  // 5) Supabase Auth に登録
  //    確認メールのリンクは必ず自サイトのコールバック(/api/auth/callback)へ戻す。
  //    これを指定しないと Supabase 既定の Site URL に飛び、code 交換が行われず
  //    「メールアドレスを登録する」→ エラー画面になる（#131 ①の原因）。
  //    パスワード再設定(requestPasswordReset)と同じ callback を使う（Redirect URL 許可済み）。
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://dx.enger.jp").replace(/\/$/, "");
  const supabase = await authServerClient();
  const { error } = await supabase.auth.signUp({
    email: rawEmail,
    password,
    options: {
      data: { full_name: name, company: company ?? "" },
      emailRedirectTo: `${site}/api/auth/callback?next=${encodeURIComponent("/login?confirmed=1")}`,
    },
  });
  if (error) {
    const msg = /already registered|already been registered|exists/i.test(error.message)
      ? "このメールアドレスは既に登録されています。ログインをお試しください。"
      : /password/i.test(error.message) ? "パスワードがポリシーを満たしません。"
      : "登録に失敗しました。しばらくしてから再度お試しください。";
    return { error: msg };
  }

  // 6) 承認待ちアカウント（既存なら冪等）
  const acc = await createPendingAccount({ email: rawEmail, name, role, companyName: company });
  if (!acc.ok) return { error: `アカウント登録に失敗しました：${acc.error ?? "不明なエラー"}` };

  // 6.5) 所属サービスの正準フラグ：app_metadata.apps に "business" を付与。
  //   フリーランスLP（enger.jp）と Auth を共有しているため、「このユーザーはビジネス側」と
  //   サーバー管理領域に明示しておく（LP側のログイン後ルーティング判定に使用）。失敗しても登録は成立。
  try { await markBusinessAuthApp(rawEmail); } catch { /* noop */ }

  // 7) 承認前はログインさせない
  try { await supabase.auth.signOut(); } catch { /* noop */ }

  return { ok: true };
}
