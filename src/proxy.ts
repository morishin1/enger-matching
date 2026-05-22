import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authProxyClient } from "@/lib/supabase-auth";

/**
 * dx.enger.jp のアクセス制御。
 *  - ログイン済み(Supabaseセッション) → 通す
 *  - 未ログイン:
 *      REQUIRE_LOGIN=true → /login へリダイレクト（個人ログイン運用）
 *      それ以外            → Basic認証にフォールバック（移行期の締め出し防止）
 *
 * ※ Next.js 16 では middleware は proxy に改名。runtime は nodejs。
 */
const truthy = (v?: string) => ["1", "true", "yes", "on"].includes((v ?? "").toLowerCase());

function basicChallenge() {
  return new NextResponse("認証が必要です", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="ENGER DX", charset="UTF-8"' } });
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公開パス（ログイン画面・API・認証）
  if (pathname.startsWith("/login") || pathname.startsWith("/api/")) return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Supabase 未設定（ローカル等）はそのまま
  if (url && anon) {
    const res = NextResponse.next();
    try {
      const supabase = authProxyClient(req, res);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) return res; // ログイン済み
    } catch { /* セッション取得失敗時は下のフォールバックへ */ }
  }

  // 未ログイン時の扱い
  if (truthy(process.env.REQUIRE_LOGIN)) {
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?redirect=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(login);
  }

  // 移行期: Basic認証（設定があれば）
  const bu = process.env.BASIC_AUTH_USER, bp = process.env.BASIC_AUTH_PASS;
  if (bu && bp) {
    const header = req.headers.get("authorization");
    if (header?.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
        const i = decoded.indexOf(":");
        if (decoded.slice(0, i) === bu && decoded.slice(i + 1) === bp) return NextResponse.next();
      } catch { /* fallthrough */ }
    }
    return basicChallenge();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
