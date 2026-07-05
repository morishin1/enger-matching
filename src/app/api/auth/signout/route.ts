import { NextResponse } from "next/server";
import { authServerClient } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// #309③：法人（企業＝client）ユーザーのログアウト後は ENGER business の入口へ戻す。
//   URL は環境変数で上書き可（既定は enger.jp/business）。社内スタッフは従来どおり dx の /login。
const BUSINESS_LOGOUT_URL = (process.env.NEXT_PUBLIC_BUSINESS_LOGOUT_URL || "https://enger.jp/business").replace(/\/$/, "");

export async function GET(req: Request) {
  const err = new URL(req.url).searchParams.get("err");

  const supabase = await authServerClient();
  // サインアウト前にロールを確認（企業=client なら enger.jp/business へ戻すため）。
  //   ※ ?err 付き（締め出し理由の表示）は従来どおり /login にメッセージ付きで戻す。
  let role: string | null = null;
  if (!err) {
    try {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email ?? "";
      if (email) { const access = await resolveAccess(email); role = access?.role ?? null; }
    } catch { /* 取得失敗時は従来どおり /login へ */ }
  }

  // scope:"local" で GoTrue への往復なしに Cookie を確実に削除する（callback の deny と同方針）。
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* noop */ }

  // ?err= が付いていればログイン画面にエラー文言を引き継ぐ（締め出し理由の表示用）。
  if (err) {
    const dest = new URL("/login", req.url);
    dest.searchParams.set("err", err);
    return NextResponse.redirect(dest);
  }
  // 法人（企業）ユーザーの明示ログアウト → ENGER business の入口へ。
  if (role === "client") return NextResponse.redirect(BUSINESS_LOGOUT_URL);
  // 社内スタッフ等は dx のログイン画面へ（再ログインしやすいように）。
  return NextResponse.redirect(new URL("/login", req.url));
}
