import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getSidebarCounts } from "@/lib/counts";
import { getStaff } from "@/lib/staff";
import { getSessionEmail, resolveAccess, type Role } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { loadMenuPermissions } from "@/lib/menu-permissions";

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

// スマホで等倍表示するためのビューポート。これが無いと iOS Safari が 980px 幅で描画してしまい、
// CSS の @media (max-width: 640px) 等の分岐が一切効かなくなる。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const fontsHref =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // サイドバーカウント・担当者マスタ・認証(ユーザー＋権限)を並列取得（逐次awaitによる体感遅延を解消）
  // 認証は getSessionEmail/resolveAccess とも cache() 済みのため、各ページ側の currentAccess と重複呼び出しされない。
  const authP = (async (): Promise<{ email: string; access: Awaited<ReturnType<typeof resolveAccess>> }> => {
    const em = await getSessionEmail();
    if (!em) return { email: "", access: null };
    return { email: em, access: await resolveAccess(em) };
  })();
  const [counts, staff, auth, menuPerms] = await Promise.all([getSidebarCounts(), getStaff(), authP, loadMenuPermissions()]);

  // 担当者候補（提案者∪クロージング、重複排除、未割当除外）
  const operators = Array.from(new Set([...staff.proposers, ...staff.closers.filter((c) => c !== "未割当")]));

  // ログイン中のユーザーを担当者マスタの email と突き合わせ、操作者の初期値に
  let defaultOperator = "";
  let role: Role = "admin"; // 認証未設定(ローカル)は全表示
  let position: "inside" | "outside" | null = null;
  let userEmail = "";
  let functions: string[] = [];
  let teamRole: string | null = null;
  let isTimecardUser = false;
  if (auth.email) {
    userEmail = auth.email;
    defaultOperator = staff.rows.find((r) => (r.email ?? "").toLowerCase() === auth.email)?.name ?? "";
    if (auth.access) { role = auth.access.role; position = auth.access.position; functions = auth.access.functions ?? []; teamRole = auth.access.teamRole ?? null; isTimecardUser = auth.access.isTimecardUser ?? false; if (!defaultOperator && auth.access.name) defaultOperator = auth.access.name; }
  }
  // タイムカードのメニューは、本人入力対象 or 承認者（マネージャー/リーダー/admin）のみ表示。
  const showTimecard = isTimecardUser || role === "admin" || canManageDept(teamRole);
  return (
    <html lang="ja" data-density="regular">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={fontsHref} />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap" />
        {/* ダークモードのちらつき(FOUC)防止：localStorage の選択を hydrate 前に <html data-theme> へ反映。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('enger.theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');}catch(e){}`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <AppShell counts={counts} operators={operators} defaultOperator={defaultOperator} role={role} position={position} userEmail={userEmail} functions={functions} teamRole={teamRole} menuPerms={menuPerms} showTimecard={showTimecard}>{children}</AppShell>
      </body>
    </html>
  );
}
