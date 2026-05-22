"use server";

import { redirect } from "next/navigation";
import { authServerClient } from "@/lib/supabase-auth";
import { engerClient } from "@/lib/supabase";

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

  // 許可リスト: 担当者マスタに email が登録されていれば、それ以外は拒否（未登録なら全許可=初期ブートストラップ）
  try {
    const sb = engerClient();
    const { data } = await sb.from("staff").select("email").eq("active", true).not("email", "is", null);
    const allow = (data ?? []).map((r: any) => String(r.email || "").toLowerCase()).filter(Boolean);
    if (allow.length > 0 && !allow.includes(email.toLowerCase())) {
      await supabase.auth.signOut();
      return { error: "このアカウントには dx へのアクセス権限がありません（管理者に担当者登録を依頼してください）" };
    }
  } catch { /* staff 未作成などは素通り */ }

  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
