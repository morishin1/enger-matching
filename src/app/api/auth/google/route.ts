import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

/** Google OAuth を開始（Supabase 経由）。完了後 /api/auth/callback に戻る。 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/api/auth/callback` },
  });
  if (error || !data?.url) {
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error?.message ?? "google_init_failed")}`);
  }
  return NextResponse.redirect(data.url);
}
