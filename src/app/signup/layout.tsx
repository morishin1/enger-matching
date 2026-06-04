import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "新規登録（無料）",
  description: "ENGER（エンジャー）に新規登録。企業はエンジニア採用、エージェントはマッチング業務を無料ではじめられます。",
  alternates: { canonical: "https://dx.enger.jp/signup" },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
