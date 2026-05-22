import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const authConfigured = Boolean(URL && ANON);

/** サーバーコンポーネント / サーバーアクション / ルートハンドラ用（next/headers の cookies を使用）。 */
export async function authServerClient() {
  const store = await cookies();
  return createServerClient(URL!, ANON!, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(toSet) {
        try { toSet.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* RSC では書込不可 */ }
      },
    },
  });
}

/** proxy(ミドルウェア)用。NextRequest から読み、NextResponse に書き戻す。 */
export function authProxyClient(req: NextRequest, res: NextResponse) {
  return createServerClient(URL!, ANON!, {
    cookies: {
      getAll() { return req.cookies.getAll(); },
      setAll(toSet) { toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
}
