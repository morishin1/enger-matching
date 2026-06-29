import { NextResponse } from "next/server";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";
import { resolveAccess } from "@/lib/accounts";
import { isDxBlockedRole, DX_BLOCKED_MESSAGE } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** OAuth/メールリンクのコールバック。code をセッションに交換し、role/status を確認して入室。 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next");
  // オープンリダイレクト防止：自サイト内の相対パスのみ許可
  const next = nextRaw && nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const errParam = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (errParam) return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(errParam)}`);
  if (!code) return NextResponse.redirect(`${origin}/login?err=missing_code`);

  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error.message)}`);

  // 入室不可時はセッションを必ず破棄してから /login へ。
  //   ※ signOut は await しないと Cookie 削除が応答の Set-Cookie に乗らず、直前の
  //     exchangeCodeForSession が立てた認証 Cookie が残り「締め出したのに入れてしまう」事故になる。
  //     scope:'local' で GoTrue への往復なしに Cookie だけ確実に削除する。
  const deny = async (msg: string) => {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* Cookie 削除はベストエフォート */ }
    return NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(msg)}`);
  };

  // role/status チェック
  const email = data?.user?.email ?? "";
  const access = await resolveAccess(email);
  if (!access) {
    // ENGER business に未登録のアカウント（Google 等の OAuth 初回や、app_users に無いメール）は入室不可。
    //   ③の方針：Google 認証は「登録済み＆承認済み」のみ通す。新規はメール＋パスワードで登録してもらう
    //   （登録後は管理者の承認でログイン可能）。自動でアカウントを作らない＝なりすまし/誤分類を防ぐ。
    return await deny("このアカウントは ENGER business に登録されていません。メールアドレスとパスワードで新規登録してください（登録後、管理者の承認でログインできます）。");
  }
  // フリーランス（人材）は法人ログイン不可。Google 認証に成功してもここで締め出す。
  if (isDxBlockedRole(access.role)) return await deny(DX_BLOCKED_MESSAGE);
  if (access.status === "pending") return await deny("メールアドレスの確認が完了しました。管理者の承認後にログインできます（承認まで今しばらくお待ちください）。");
  if (access.status === "disabled") return await deny("このアカウントは無効化されています。管理者にお問い合わせください。");

  return NextResponse.redirect(`${origin}${next}`);
}
