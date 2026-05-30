"use server";

import { authServerClient } from "@/lib/supabase-auth";
import { createPendingAccount } from "@/lib/accounts";

export type SignupState = { error?: string; ok?: boolean } | null;

/** 自己登録。Supabase にユーザー作成 → app_users を承認待ちで登録。管理者承認後にログイン可。 */
export async function signUp(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "client");
  const role: "agent" | "client" | "candidate" | "partner" | "freelance" =
    roleRaw === "agent" ? "agent" : roleRaw === "candidate" ? "candidate" : roleRaw === "partner" ? "partner" : roleRaw === "freelance" ? "freelance" : "client";

  if (!email || !password) return { error: "メールアドレスとパスワードを入力してください" };
  if (password.length < 8) return { error: "パスワードは8文字以上で設定してください" };
  if (!name) return { error: "お名前（ご担当者名）を入力してください" };
  // 副業エージェント(freelance)は個人なので会社名は任意。企業/パートナーは必須。
  if ((role === "client" || role === "partner") && !company) return { error: "会社名を入力してください" };

  const supabase = await authServerClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name, company } },
  });
  if (error) {
    const msg = /already registered|already been registered|exists/i.test(error.message)
      ? "このメールアドレスは既に登録されています。ログインをお試しください。"
      : error.message;
    return { error: msg };
  }

  // 承認待ちアカウントを作成（既に存在すればそのまま）
  const acc = await createPendingAccount({ email, name, role, companyName: (role === "client" || role === "partner") ? company : (role === "freelance" ? (company || null) : null) });
  if (!acc.ok) return { error: `アカウント登録に失敗しました：${acc.error ?? "不明なエラー"}` };

  // 自動でセッションが張られても入室はさせない（承認待ち）
  try { await supabase.auth.signOut(); } catch { /* noop */ }

  return { ok: true };
}
