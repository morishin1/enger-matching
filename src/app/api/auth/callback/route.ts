import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authServerClient, publicOrigin } from "@/lib/supabase-auth";
import { resolveAccess, createPendingAccount } from "@/lib/accounts";
import { isDxBlockedRole, DX_BLOCKED_MESSAGE } from "@/lib/roles";
import { hasFreelanceProfile, markBusinessAuthApp } from "@/lib/auth-apps";
import { isDisposableEmail } from "@/lib/signup-security";
import { OAUTH_NEXT_COOKIE, safeNext, clearOAuthNext } from "@/lib/oauth-next";

export const dynamic = "force-dynamic";

/** OAuth/メールリンクのコールバック。code をセッションに交換し、role/status を確認して入室。 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const code = url.searchParams.get("code");
  // 遷移先(next)は redirectTo のクエリではなく短命Cookieで運ぶ（Supabase 許可リスト対策・
  //   詳細は lib/oauth-next.ts）。後方互換で ?next= が付いていればそちらを優先。
  const store = await cookies();
  const next = safeNext(url.searchParams.get("next") ?? store.get(OAUTH_NEXT_COOKIE)?.value);
  const errParam = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (errParam) return clearOAuthNext(NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(errParam)}`));
  if (!code) return clearOAuthNext(NextResponse.redirect(`${origin}/login?err=missing_code`));

  const supabase = await authServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return clearOAuthNext(NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(error.message)}`));

  // 入室不可時はセッションを必ず破棄してから /login へ。
  //   ※ signOut は await しないと Cookie 削除が応答の Set-Cookie に乗らず、直前の
  //     exchangeCodeForSession が立てた認証 Cookie が残り「締め出したのに入れてしまう」事故になる。
  //     scope:'local' で GoTrue への往復なしに Cookie だけ確実に削除する。
  const deny = async (msg: string) => {
    try { await supabase.auth.signOut({ scope: "local" }); } catch { /* Cookie 削除はベストエフォート */ }
    return clearOAuthNext(NextResponse.redirect(`${origin}/login?err=${encodeURIComponent(msg)}`));
  };

  // role/status チェック
  const email = data?.user?.email ?? "";
  const access = await resolveAccess(email);
  if (!access) {
    // ENGER business に未登録のアカウント（Google/GitHub の OAuth 初回や、app_users に無いメール）。
    //   フリーランス（profiles）として登録済みのメールは、ビジネスへ取り込まず明示して案内する
    //   （同一メールをフリーランス⇄ビジネスで取り違えないため）。
    if (await hasFreelanceProfile(email)) {
      return await deny("このメールアドレスは ENGERフリーランス（個人）として登録されています。フリーランスの方は enger.jp からログインしてください。ビジネス（企業・社内）として利用する場合は、別のメールアドレスで新規登録してください（管理者の承認後にログインできます）。");
    }
    // 使い捨てメールは登録不可（メール+パスワード登録と同じ扱い。承認待ちアカウントの乱造を防ぐ）。
    if (isDisposableEmail(email)) {
      return await deny("このメールアドレスでは ENGER business に登録できません。会社のメールアドレスでご登録ください。");
    }
    // #309②：Google/GitHub 認証での新規は、メール＋パスワード登録と同じく
    //   「ENGER business の承認待ちアカウント」を作成する（メール認証は OAuth 完了で済んでいる）。
    //   ・自動ログインはさせない：作成後もセッションは破棄し、承認待ちメッセージを出す（deny）。
    //   ・app_metadata.apps に "business" を付与し、LP(enger.jp)側の以後のルーティングが
    //     フリーランスではなくビジネスへ向くようにする（②の「フリーランス画面に飛ぶ」対策）。
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, any>;
    const name = String(meta.full_name || meta.name || "").trim() || null;
    try {
      await createPendingAccount({ email, name, role: "client", companyName: null });
      await markBusinessAuthApp(email);
    } catch { /* 作成失敗でも下の承認案内は出す */ }
    return await deny("ENGER business への登録を受け付けました（メール認証は完了）。会社名など詳細を管理者が確認し、承認後にログインできるようになります。次回は Google／GitHub でそのままログインできます。");
  }
  // フリーランス（人材）は法人ログイン不可。Google 認証に成功してもここで締め出す。
  if (isDxBlockedRole(access.role)) return await deny(DX_BLOCKED_MESSAGE);
  if (access.status === "pending") return await deny("メールアドレスの確認が完了しました。管理者の承認後にログインできます（承認まで今しばらくお待ちください）。");
  if (access.status === "disabled") return await deny("このアカウントは無効化されています。管理者にお問い合わせください。");

  return clearOAuthNext(NextResponse.redirect(`${origin}${next}`));
}
