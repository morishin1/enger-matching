import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";
import { OAUTH_NEXT_COOKIE, safeNext } from "@/lib/oauth-next";

export const dynamic = "force-dynamic";

/** Google OAuth を開始（Supabase 経由）。完了後 /api/auth/callback に戻る。
 *  ・?next=/people/123 のようにログイン後の遷移先を引き継ぐ（紹介リンク対応。相対パスのみ許可）。
 *  ・prompt=select_account：Google のアカウント選択を必ず表示する。ブラウザに残っている
 *    フリーランス用の Google アカウントで自動ログインされ「フリーランス側に入ってしまう」誤爆を防ぐ。
 *
 *  ★ redirectTo にクエリ（?next=）を付けない：Supabase の「Redirect URLs 許可リスト」は
 *    クエリ付きURLだと完全一致エントリ（https://dx.enger.jp/api/auth/callback）に一致せず、
 *    Site URL（enger.jp）へフォールバックしてしまう。結果「Googleログイン後に enger.jp の
 *    トップへ ?code= で飛ぶ／dx に入れない」事故になる。遷移先(next)は短命Cookieで受け渡す。 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error?.message ?? "google_init_failed")}`);
  }
  const res = NextResponse.redirect(data.url);
  res.cookies.set(OAUTH_NEXT_COOKIE, next, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
