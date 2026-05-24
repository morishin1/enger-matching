import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ログイン",
  description: "ENGER（エンジャー）にログイン。案件×人材マッチング・提案・契約・稼働管理を、ひとつの画面で。",
  alternates: { canonical: "https://dx.enger.jp/login" },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
