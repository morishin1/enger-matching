/**
 * OAuth（Google/GitHub）ログイン後の遷移先(next)を、redirectTo のクエリではなく
 * 短命Cookieで受け渡すためのヘルパ。
 *
 * なぜクエリを使わないか：Supabase の「Redirect URLs 許可リスト」は、クエリ付きの
 * redirectTo（例: .../api/auth/callback?next=%2F）だと完全一致エントリに一致せず、
 * Site URL（enger.jp）へフォールバックしてしまう。その結果「Googleログイン後に
 * enger.jp のトップへ ?code= で着地し dx に入れない」事故になる。redirectTo は
 * クエリ無しの固定URLに保ち、next はこのCookieで運ぶ。
 */
import type { NextResponse } from "next/server";

export const OAUTH_NEXT_COOKIE = "dx_oauth_next";

/** オープンリダイレクト防止：自サイト内の相対パスのみ許可。既定は "/"。 */
export function safeNext(raw: string | null | undefined): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/** 使い終わった next Cookie を削除する（毎レスポンスで消してリークを防ぐ）。 */
export function clearOAuthNext(res: NextResponse): NextResponse {
  res.cookies.set(OAUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
