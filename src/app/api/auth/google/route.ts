import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

/** Google OAuth を開始（Supabase 経由）。完了後 /api/auth/callback に戻る。
 *  ・?next=/people/123 のようにログイン後の遷移先を引き継ぐ（紹介リンク対応。相対パスのみ許可）。
 *  ・prompt=select_account：Google のアカウント選択を必ず表示する。ブラウザに残っている
 *    フリーランス用の Google アカウントで自動ログインされ「フリーランス側に入ってしまう」誤爆を防ぐ。 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const nextRaw = url.searchParams.get("next");
  const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error?.message ?? "google_init_failed")}`);
  }
  return NextResponse.redirect(data.url);
}
