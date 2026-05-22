import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getSidebarCounts } from "@/lib/counts";
import { getStaff } from "@/lib/staff";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess, type Role } from "@/lib/accounts";

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
  let role: Role = "admin"; // 認証未設定(ローカル)は全表示
  let position: "inside" | "outside" | null = null;
  let userEmail = "";
  if (authConfigured) {
    try {
      const sb = await authServerClient();
      const { data: { user } } = await sb.auth.getUser();
      const em = user?.email?.toLowerCase();
      if (em) {
        userEmail = em;
        defaultOperator = staff.rows.find((r) => (r.email ?? "").toLowerCase() === em)?.name ?? "";
        const access = await resolveAccess(em);
        if (access) { role = access.role; position = access.position; if (!defaultOperator && access.name) defaultOperator = access.name; }
      }
    } catch { /* noop */ }
  }
  return (
    <html lang="ja" data-density="regular">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={fontsHref} />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
      </head>
      <body>
        <AppShell counts={counts} operators={operators} defaultOperator={defaultOperator} role={role} position={position} userEmail={userEmail}>{children}</AppShell>
      </body>
    </html>
  );
}
