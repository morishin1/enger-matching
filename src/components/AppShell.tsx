"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "@/components/AppLink";
import { Sidebar } from "./Sidebar";
import { Toaster } from "./toast";
import { OperatorBadge } from "./OperatorBadge";
import { HelpButton } from "./HelpButton";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import type { Role } from "@/lib/roles";

const CRUMBS: Record<string, string[]> = {
  "/": ["ENGER", "ダッシュボード"],
  "/matching": ["ENGER", "マッチング"],
  "/engineers": ["ENGER", "フリーランス"],
  "/jobs": ["ENGER", "案件"],
  "/people": ["ENGER", "人材"],
  "/line": ["ENGER", "LINE"],
  "/chat": ["ENGER", "チャット"],
  "/companies": ["ENGER", "企業管理"],
  "/proposals": ["ENGER", "提案管理"],
  "/progress": ["ENGER", "稼働管理"],
  "/timecard": ["ENGER", "タイムカード"],
  "/trash": ["ENGER", "ゴミ箱"],
  "/billing": ["ENGER", "請求・勤怠"],
  "/reports": ["ENGER", "日報"],
  "/notifications": ["ENGER", "お知らせ"],
  "/meetings": ["ENGER", "打合せ記録"],
  "/pipeline": ["ENGER", "分析", "パイプライン"],
  "/documents": ["ENGER", "分析", "書類送付"],
  "/analytics": ["ENGER", "分析"],
  "/kpi": ["ENGER", "KPI 推移"],
  "/mail": ["ENGER", "メール"],
  "/inbox": ["ENGER", "受信箱"],
  "/ai": ["ENGER", "AIアシスタント"],
  "/settings": ["ENGER", "設定"],
  "/search": ["ENGER", "検索"],
  "/portal": ["ENGER", "ポータル"],
  "/portal/jobs": ["ENGER", "自社案件"],
  "/portal/candidates": ["ENGER", "おすすめ人材"],
  "/portal/selection": ["ENGER", "選考管理"],
  "/portal/company": ["ENGER", "自社情報"],
};

// トップバーに出すページのタイトル＋説明（空きスペースを活用）。本文側の page-head タイトルは
//   .has-tb-head のとき CSS で隠して重複を防ぐ（ボタンは残る）。
const PAGE_HEAD: Record<string, { meta?: string; title: string; sub?: string }> = {
  "/":          { meta: "Dashboard",            title: "ダッシュボード", sub: "新着ニュースと売上KPI" },
  "/matching":  { meta: "Matching · 案件 × 人材", title: "マッチング",     sub: "案件を選ぶと、スキル一致を主軸（単価・職種・リモートで補正）に候補をランキング表示します。" },
  "/jobs":      { meta: "Jobs · 案件マスタ",      title: "案件",          sub: "募集中の案件を管理します。" },
  "/people":    { meta: "People · 人材マスタ",    title: "人材",          sub: "登録人材を管理します。" },
  "/engineers": { meta: "Freelance",             title: "フリーランス",   sub: "ENGERフリーランスの登録者一覧。" },
  "/line":      { meta: "LINE",                  title: "LINE",          sub: "LINE経由の人材・案件とLINE WORKSのやりとり。" },
  "/proposals": { meta: "Proposals",             title: "提案管理",       sub: "提案の進捗（KPI/KGI・承認・ボード・失注分析）。" },
  "/companies": { meta: "Companies",             title: "企業管理",       sub: "取引先・商談の管理。" },
  "/progress":  { meta: "Engagements",           title: "稼働管理",       sub: "稼働・請求・書類の管理。" },
  "/chat":      { meta: "Chat",                  title: "チャット",       sub: "人材・企業とのやりとり。" },
  "/mail":      { meta: "Mail",                  title: "メール取込",     sub: "案件・人材メールを取り込み。" },
  "/meetings":  { meta: "Meetings",              title: "打ち合わせ記録", sub: "商談メモ・フィードバック。" },
  "/reports":   { meta: "Reports",               title: "日報",          sub: "気づき・改善の記録。" },
  "/kpi":       { meta: "KPI",                   title: "KPI推移",       sub: "KPI・KGIの推移。" },
  "/settings":  { meta: "Settings",              title: "設定",          sub: "アカウント・各種設定。" },
};

const ROLE_BADGE: Record<Role, { label: string; bg: string; fg: string }> = {
  admin: { label: "管理者", bg: "#efe7fb", fg: "#6b21a8" },
  agent: { label: "エージェント", bg: "#eaf4fd", fg: "#0b5cab" },
  client: { label: "ユーザー企業", bg: "#e7f7ee", fg: "#067647" },
  candidate: { label: "人材", bg: "#fff1e6", fg: "#b45309" },
  partner: { label: "パートナー企業", bg: "#eef2ff", fg: "#3730a3" },
  freelance: { label: "副業エージェント", bg: "#fef3f2", fg: "#b42318" },
};

const POSITION_LABEL: Record<string, string> = { inside: "インサイドセールス", outside: "アウトサイドセールス" };

export function AppShell({ children, counts, operators, defaultOperator, role = "admin", position = null, userEmail = "", functions = [], teamRole = null, menuPerms, showTimecard = false }: { children: React.ReactNode; counts?: SidebarCounts; operators?: string[]; defaultOperator?: string; role?: Role; position?: "inside" | "outside" | null; userEmail?: string; functions?: string[]; teamRole?: string | null; menuPerms?: import("@/lib/menu-permissions").MenuPermissions; showTimecard?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  // ログイン/新規登録/公開LP/規約/メール回答/外部共有 はシェル(サイドバー/トップバー)なしで表示
  if (pathname === "/login" || pathname === "/signup" || pathname === "/agent" || pathname === "/terms" || pathname === "/privacy" || pathname.startsWith("/respond") || pathname.startsWith("/share") || pathname === "/ref" || pathname.startsWith("/ref/")) return <>{children}</>;

  const key = pathname === "/" ? "/" : (pathname.startsWith("/portal/") ? pathname : "/" + pathname.split("/")[1]);
  const crumbs = CRUMBS[key] ?? ["ENGER"];
  const head = PAGE_HEAD[key];
  const [q, setQ] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K で検索にフォーカス
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ページ遷移でモバイルのドロワーを閉じる
  useEffect(() => { setNavOpen(false); }, [pathname]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className={"app" + (role === "client" ? " theme-client" : "")}>
      <Sidebar counts={counts} role={role} open={navOpen} functions={functions} teamRole={teamRole} menuPerms={menuPerms} showTimecard={showTimecard} />
      <div className={"nav-overlay" + (navOpen ? " show" : "")} onClick={() => setNavOpen(false)} aria-hidden />
      <main className={"main" + (head ? " has-tb-head" : "")}>
        <div className="topbar">
          <button className="nav-toggle" onClick={() => setNavOpen((v) => !v)} aria-label="メニュー">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          {/* ページのタイトル＋説明をトップバーの空きスペースに表示。 */}
          {head ? (
            <div className="tb-head">
              {head.meta && <div className="tb-meta">{head.meta}</div>}
              <div className="tb-title">{head.title}</div>
              {head.sub && <div className="tb-sub">{head.sub}</div>}
            </div>
          ) : crumbs.length > 2 ? (
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <span key={i} style={{ display: "contents" }}>
                  {i > 0 && <span className="sep">/</span>}
                  {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
                </span>
              ))}
            </div>
          ) : null}
          <form className="search" onSubmit={submit}>
            <span style={{ display: "grid", placeItems: "center" }}><Icons.search /></span>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件・人材・会社・フリーランス（ID/No・E番号・氏名）…Enterで検索" />
            <kbd>⌘K</kbd>
          </form>
          <HelpButton />
          {/* お知らせベル（#235②）：提案の承認待ち・差戻しがあるとき赤バッジ＋件数を表示し、
              クリックで提案管理（承認タブが自動で開く）へ。無いときは通常のお知らせへ。 */}
          {(() => {
            const approvals = counts?.proposalApprovals ?? 0;
            const has = approvals > 0;
            return (
              <Link href={has ? "/proposals" : "/notifications"} className="icon-btn"
                title={has ? `承認待ちが ${approvals} 件あります（クリックで承認へ）` : "お知らせ"}
                style={{ position: "relative" }}>
                <Icons.bell />
                {has ? (
                  <span aria-label={`承認待ち ${approvals} 件`}
                    style={{ position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 99, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: "16px", textAlign: "center", border: "1.5px solid var(--color-surface, #fff)", boxSizing: "border-box" }}>
                    {approvals > 99 ? "99+" : approvals}
                  </span>
                ) : null}
              </Link>
            );
          })()}
          <span title="権限ロール" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: ROLE_BADGE[role].bg, color: ROLE_BADGE[role].fg, whiteSpace: "nowrap" }}>{ROLE_BADGE[role].label}</span>
          {position && POSITION_LABEL[position] && (
            <span title="営業区分" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: position === "outside" ? "#fff1e6" : "#eaf4fd", color: position === "outside" ? "#b45309" : "#0b5cab", whiteSpace: "nowrap" }}>{POSITION_LABEL[position]}</span>
          )}
          <OperatorBadge defaultName={defaultOperator} email={userEmail} role={role} compact />
        </div>
        {children}
      </main>
      <Toaster />
    </div>
  );
}
