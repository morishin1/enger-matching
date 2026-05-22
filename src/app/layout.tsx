import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getSidebarCounts } from "@/lib/counts";
import { getStaff } from "@/lib/staff";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";

export const metadata: Metadata = {
  title: "ENGER v2 — Matching",
  description: "案件×人材マッチング・提案・稼働・企業管理プラットフォーム",
};

const fontsHref =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const counts = await getSidebarCounts();
  const staff = await getStaff();
  // 担当者候補（提案者∪クロージング、重複排除、未割当除外）
  const operators = Array.from(new Set([...staff.proposers, ...staff.closers.filter((c) => c !== "未割当")]));

  // ログイン中のユーザーを担当者マスタの email と突き合わせ、操作者の初期値に
  let defaultOperator = "";
  if (authConfigured) {
    try {
      const sb = await authServerClient();
      const { data: { user } } = await sb.auth.getUser();
      const em = user?.email?.toLowerCase();
      if (em) defaultOperator = staff.rows.find((r) => (r.email ?? "").toLowerCase() === em)?.name ?? "";
    } catch { /* noop */ }
  }
  return (
    <html lang="ja" data-density="regular">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={fontsHref} />
      </head>
      <body>
        <AppShell counts={counts} operators={operators} defaultOperator={defaultOperator}>{children}</AppShell>
      </body>
    </html>
  );
}
