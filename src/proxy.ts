import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authProxyClient } from "@/lib/supabase-auth";
import { resolveAccess, canAccess } from "@/lib/accounts";

/**
 * dx.enger.jp のアクセス制御。
 *  - 未ログイン → /login へリダイレクト
 *  - ログイン済み:
 *      status!=active → /login へ（承認待ち/無効）
 *      role でアクセス可能ルートを制限（client=自社まわりのみ / settings=adminのみ）
 *
 * ※ Basic認証フォールバックは廃止（ログイン画面へ一本化）。
 * ※ Next.js 16 では middleware は proxy に改名。runtime は nodejs。
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公開パス（ログイン画面・新規登録・パスワード再設定・API・認証）
  // ※ パスワードを忘れた未ログインユーザーがアクセスするため /forgot-password と /reset-password も公開必須。
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/api/")
  ) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase 未設定（ローカル等）はゲートせず通す
  if (!url || !anon) return NextResponse.next();

  const res = NextResponse.next();
  try {
    const supabase = authProxyClient(req, res);
    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) {
      const access = await resolveAccess(user.email);
      // 未許可 or 承認待ち/無効 → ログインへ（メッセージ付き）
      if (!access || access.status !== "active") {
        const login = req.nextUrl.clone();
        login.pathname = "/login";
        login.search = `?err=${encodeURIComponent(!access ? "アクセス権限がありません" : access.status === "pending" ? "承認待ちです" : "無効化されています")}`;
        return NextResponse.redirect(login);
      }
      // ロール別ルート制限。許可外は自分のホームへ。
      if (!canAccess(access.role, pathname, access.functions)) {
        const home = req.nextUrl.clone();
        home.pathname = "/";
        home.search = "";
        return NextResponse.redirect(home);
      }
      return res; // OK
    }
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
