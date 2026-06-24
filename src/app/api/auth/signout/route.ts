import { NextResponse } from "next/server";
import { authServerClient } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabase = await authServerClient();
    await supabase.auth.signOut();
  } catch { /* noop */ }
  // ?err= が付いていればログイン画面にエラー文言を引き継ぐ（締め出し理由の表示用）。
  const err = new URL(req.url).searchParams.get("err");
  const dest = new URL("/login", req.url);
  if (err) dest.searchParams.set("err", err);
  return NextResponse.redirect(dest);
}
