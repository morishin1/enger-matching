import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Basic 認証で社内ツール(dx.enger.jp)全体をガードする。
 * Vercel の Environment Variables に以下を設定すると有効化:
 *   BASIC_AUTH_USER, BASIC_AUTH_PASS
 * どちらか未設定なら素通り（ローカル開発・初回デプロイで締め出さないため）。
 *
 * ※ Next.js 16 では middleware は proxy に改名。runtime は nodejs 固定。
 */
export function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === user && p === pass) return NextResponse.next();
    } catch {
      // fallthrough to 401
    }
  }

  return new NextResponse("認証が必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ENGER DX", charset="UTF-8"' },
  });
}

export const config = {
  // 静的アセットは除外（ログイン後に画像/JSが読めるように）
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
