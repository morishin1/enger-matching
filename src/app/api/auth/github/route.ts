import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";
import { OAUTH_NEXT_COOKIE, safeNext } from "@/lib/oauth-next";

export const dynamic = "force-dynamic";

/** GitHub OAuth を開始（Supabase 経由）。完了後 /api/auth/callback に戻る（#309②）。
 *  ・?next=/people/123 のようにログイン後の遷移先を引き継ぐ（相対パスのみ許可）。
 *  ・初回は callback 側で ENGER business の承認待ちアカウントを作成する（メール+パスワード登録と同じ扱い）。
 *  ※ Supabase 側で GitHub プロバイダが未有効の場合はエラーになり /login にメッセージを出す。
 *
 *  ★ redirectTo にクエリ（?next=）を付けない（Supabase 許可リストの完全一致を壊さないため）。
 *    遷移先(next)は短命Cookieで受け渡す（google/route.ts と同じ理由。詳細は lib/oauth-next.ts）。 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/api/auth/callback`,
    },
  });
  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error?.message ?? "github_init_failed")}`);
  }
  const res = NextResponse.redirect(data.url);
  res.cookies.set(OAUTH_NEXT_COOKIE, next, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
