"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Sidebar } from "./Sidebar";
import { OperatorBadge } from "./OperatorBadge";
import { HelpButton } from "./HelpButton";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import type { Role } from "@/lib/roles";

const CRUMBS: Record<string, string[]> = {
  "/": ["ENGER", "ダッシュボード"],
  "/matching": ["ENGER", "マッチング"],
  "/engineers": ["ENGER", "LP登録"],
  "/jobs": ["ENGER", "案件"],
  "/people": ["ENGER", "人材"],
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
  "/portal/company": ["ENGER", "企業プロフィール"],
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

  // ログイン/新規登録/公開LP/規約/メール回答 はシェル(サイドバー/トップバー)なしで表示
  if (pathname === "/login" || pathname === "/signup" || pathname === "/agent" || pathname === "/terms" || pathname === "/privacy" || pathname.startsWith("/respond")) return <>{children}</>;

  const key = pathname === "/" ? "/" : (pathname.startsWith("/portal/") ? pathname : "/" + pathname.split("/")[1]);
  const crumbs = CRUMBS[key] ?? ["ENGER"];
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
      <main className="main">
        <div className="topbar">
          <button className="nav-toggle" onClick={() => setNavOpen((v) => !v)} aria-label="メニュー">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <span className="sep">/</span>}
                {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
              </span>
            ))}
          </div>
          {/* マッチング/案件/人材/LP登録 のタブは各ページ本体上部（MatchingPeerTabs）に統一配置した */}
          <form className="search" onSubmit={submit}>
            <span style={{ display: "grid", placeItems: "center" }}><Icons.search /></span>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件・人材・会社（ID/No・名前・スキル）…Enterで検索" />
            <kbd>⌘K</kbd>
          </form>
          <HelpButton />
          <Link href="/notifications" className="icon-btn" title="お知らせ"><Icons.bell /><span className="dot" /></Link>
          <span title="権限ロール" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: ROLE_BADGE[role].bg, color: ROLE_BADGE[role].fg, whiteSpace: "nowrap" }}>{ROLE_BADGE[role].label}</span>
          {position && POSITION_LABEL[position] && (
            <span title="営業区分" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: position === "outside" ? "#fff1e6" : "#eaf4fd", color: position === "outside" ? "#b45309" : "#0b5cab", whiteSpace: "nowrap" }}>{POSITION_LABEL[position]}</span>
          )}
          <OperatorBadge defaultName={defaultOperator} email={userEmail} role={role} compact />
        </div>
        {children}
      </main>
    </div>
  );
}
