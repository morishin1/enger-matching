import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";
import { isAllowedEmail } from "@/lib/staff";

export const dynamic = "force-dynamic";

/** OAuth/メールリンクのコールバック。code をセッションに交換し、許可リストを確認して入室。 */
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

  // 許可リスト（担当者マスタの email）チェック
  const email = data?.user?.email ?? "";
  if (email && !(await isAllowedEmail(email))) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent("このアカウントには dx へのアクセス権限がありません")}`);
  }
  return NextResponse.redirect(`${origin}/`);
}
