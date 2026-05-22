import { NextResponse } from "next/server";
import { authServerClient } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabase = await authServerClient();
    await supabase.auth.signOut();
  } catch { /* noop */ }
  return NextResponse.redirect(new URL("/login", req.url));
}
