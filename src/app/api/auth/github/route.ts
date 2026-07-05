import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

/** GitHub OAuth を開始（Supabase 経由）。完了後 /api/auth/callback に戻る（#309②）。
 *  ・?next=/people/123 のようにログイン後の遷移先を引き継ぐ（相対パスのみ許可）。
 *  ・初回は callback 側で ENGER business の承認待ちアカウントを作成する（メール+パスワード登録と同じ扱い）。
 *  ※ Supabase 側で GitHub プロバイダが未有効の場合はエラーになり /login にメッセージを出す。 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const nextRaw = url.searchParams.get("next");
  const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error?.message ?? "github_init_failed")}`);
  }
  return NextResponse.redirect(data.url);
}
