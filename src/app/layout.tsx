import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getSidebarCounts } from "@/lib/counts";
import { getStaff } from "@/lib/staff";
import { authServerClient, authConfigured } from "@/lib/supabase-auth";
import { resolveAccess, type Role } from "@/lib/accounts";

export const metadata: Metadata = {
  metadataBase: new URL("https://dx.enger.jp"),
  title: {
    default: "ENGER（エンジャー）｜案件×人材マッチング・採用管理プラットフォーム",
    template: "%s｜ENGER",
  },
  description:
    "ENGER（エンジャー）は、エンジニア採用・人材紹介/派遣/SESを、AIマッチングから提案・契約・稼働管理までひとつの画面で完結する採用管理プラットフォームです。",
  applicationName: "ENGER",
  keywords: ["ENGER", "エンジャー", "人材マッチング", "エンジニア採用", "SES", "人材紹介", "派遣", "採用管理", "マッチングプラットフォーム"],
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: "https://dx.enger.jp",
    siteName: "ENGER",
    title: "ENGER（エンジャー）｜案件×人材マッチング・採用管理プラットフォーム",
    description: "エンジニア採用・人材紹介/派遣/SESを、AIマッチングから提案・契約・稼働管理までひとつの画面で。",
    images: [{ url: "/15.png", width: 1200, height: 630, alt: "ENGER" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ENGER（エンジャー）｜案件×人材マッチング・採用管理",
    description: "エンジニア採用・人材紹介/派遣/SESをひとつの画面で。",
    images: ["/15.png"],
  },
  robots: { index: true, follow: true },
  icons: { icon: "/enger-logo.png" },
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
  let functions: string[] = [];
  if (authConfigured) {
    try {
      const sb = await authServerClient();
      const { data: { user } } = await sb.auth.getUser();
      const em = user?.email?.toLowerCase();
      if (em) {
        userEmail = em;
        defaultOperator = staff.rows.find((r) => (r.email ?? "").toLowerCase() === em)?.name ?? "";
        const access = await resolveAccess(em);
        if (access) { role = access.role; position = access.position; functions = access.functions ?? []; if (!defaultOperator && access.name) defaultOperator = access.name; }
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
        <AppShell counts={counts} operators={operators} defaultOperator={defaultOperator} role={role} position={position} userEmail={userEmail} functions={functions}>{children}</AppShell>
      </body>
    </html>
  );
}
