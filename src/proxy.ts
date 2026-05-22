import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authProxyClient } from "@/lib/supabase-auth";

/**
 * dx.enger.jp のアクセス制御。
 *  - ログイン済み(Supabaseセッション) → 通す
 *  - 未ログイン → /login へリダイレクト
 *
 * ※ Basic認証フォールバックは廃止（ログイン画面へ一本化）。
 * ※ Next.js 16 では middleware は proxy に改名。runtime は nodejs。
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公開パス（ログイン画面・API・認証）
  if (pathname.startsWith("/login") || pathname.startsWith("/api/")) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase 未設定（ローカル等）はゲートせず通す
  if (!url || !anon) return NextResponse.next();

  const res = NextResponse.next();
  try {
    const supabase = authProxyClient(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return res; // ログイン済み
  } catch { /* セッション取得失敗 → 未ログイン扱いで /login へ */ }

  // 未ログイン → ログイン画面へ
  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?redirect=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
