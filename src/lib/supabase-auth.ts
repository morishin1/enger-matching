import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const authConfigured = Boolean(SB_URL && SB_ANON);

/** サーバーコンポーネント / サーバーアクション / ルートハンドラ用（next/headers の cookies を使用）。 */
export async function authServerClient() {
  const store = await cookies();
  return createServerClient(SB_URL!, SB_ANON!, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(toSet) {
        try { toSet.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* RSC では書込不可 */ }
      },
    },
  });
}

/** リクエストから公開オリジン(https://dx.enger.jp 等)を導出。Vercelの転送ヘッダを優先。 */
export function publicOrigin(req: Request): string {
  const env = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
  if (env.NEXT_PUBLIC_SITE_URL) return env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host && !/^(localhost|127\.0\.0\.1)/.test(host)) return `${proto}://${host}`;
  try { return new URL(req.url).origin; } catch { return "https://dx.enger.jp"; }
}

/** proxy(ミドルウェア)用。NextRequest から読み、NextResponse に書き戻す。 */
export function authProxyClient(req: NextRequest, res: NextResponse) {
  return createServerClient(SB_URL!, SB_ANON!, {
    cookies: {
      getAll() { return req.cookies.getAll(); },
      setAll(toSet) { toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
}
