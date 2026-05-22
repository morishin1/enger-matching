import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getSidebarCounts } from "@/lib/counts";

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
  return (
    <html lang="ja" data-density="regular">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={fontsHref} />
      </head>
      <body>
        <AppShell counts={counts}>{children}</AppShell>
      </body>
    </html>
  );
}
