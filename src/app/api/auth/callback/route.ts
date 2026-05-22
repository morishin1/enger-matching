import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";
import { resolveAccess, createPendingAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/** OAuth/メールリンクのコールバック。code をセッションに交換し、role/status を確認して入室。 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const code = url.searchParams.get("code");
  const errParam = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (errParam) return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(errParam)}`);
  if (!code) return NextResponse.redirect(`${origin}/login?err=missing_code`);

  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error.message)}`);

  const deny = (msg: string) => { void supabase.auth.signOut(); return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(msg)}`); };

  // role/status チェック
  const email = data?.user?.email ?? "";
  const access = await resolveAccess(email);
  if (!access) {
    // 初回ログイン → 承認待ちアカウントを自動作成して案内
    const name = (data?.user?.user_metadata?.full_name as string) || (data?.user?.user_metadata?.name as string) || null;
    await createPendingAccount({ email, name, role: "client" });
    return deny("登録を受け付けました。管理者の承認後にログインできます。");
  }
  if (access.status === "pending") return deny("このアカウントは承認待ちです。管理者の承認後にログインできます。");
  if (access.status === "disabled") return deny("このアカウントは無効化されています。管理者にお問い合わせください。");

  return NextResponse.redirect(`${origin}/`);
}
