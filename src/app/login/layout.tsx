import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionEmail, resolveAccess } from "@/lib/accounts";

export const metadata: Metadata = {
  title: "ログイン",
  description: "ENGER（エンジャー）にログイン。案件×人材マッチング・提案・契約・稼働管理を、ひとつの画面で。",
  alternates: { canonical: "https://dx.enger.jp/login" },
};

/** 既ログインなら /login を踏んでもトップへ。
 *  → 別タブでブックマーク/履歴から /login を開いた時に再ログインを要求されないようにする。 */
export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  let loggedIn = false;
  try {
    const email = await getSessionEmail();
    if (email) {
      const access = await resolveAccess(email);
      loggedIn = !!(access && access.status === "active");
    }
  } catch { /* セッション解決失敗時はそのままログイン画面 */ }
  if (loggedIn) redirect("/");
  return <>{children}</>;
}
