"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { OperatorBadge } from "./OperatorBadge";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";
import type { Role } from "@/lib/roles";

const CRUMBS: Record<string, string[]> = {
  "/": ["ENGER", "ダッシュボード"],
  "/matching": ["ENGER", "マッチング"],
  "/jobs": ["ENGER", "案件"],
  "/people": ["ENGER", "人材"],
  "/companies": ["ENGER", "企業管理"],
  "/proposals": ["ENGER", "提案管理"],
  "/progress": ["ENGER", "稼働管理"],
  "/meetings": ["ENGER", "打合せ記録"],
  "/pipeline": ["ENGER", "パイプライン"],
  "/analytics": ["ENGER", "分析"],
  "/inbox": ["ENGER", "受信箱"],
  "/ai": ["ENGER", "AIアシスタント"],
  "/settings": ["ENGER", "設定"],
  "/search": ["ENGER", "検索"],
  "/portal": ["ENGER", "自社案件"],
};

const ROLE_BADGE: Record<Role, { label: string; bg: string; fg: string }> = {
  admin: { label: "管理者", bg: "#efe7fb", fg: "#6b21a8" },
  agent: { label: "営業", bg: "#eaf4fd", fg: "#0b5cab" },
  client: { label: "ユーザー企業", bg: "#e7f7ee", fg: "#067647" },
};

export function AppShell({ children, counts, operators, defaultOperator, role = "admin" }: { children: React.ReactNode; counts?: SidebarCounts; operators?: string[]; defaultOperator?: string; role?: Role }) {
  const pathname = usePathname();
  const router = useRouter();

  // ログイン/新規登録画面はシェル(サイドバー/トップバー)なしで表示
  if (pathname === "/login" || pathname === "/signup") return <>{children}</>;

  const key = pathname === "/" ? "/" : "/" + pathname.split("/")[1];
  const crumbs = CRUMBS[key] ?? ["ENGER"];
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K で検索にフォーカス
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  return (
    <div className="app">
      <Sidebar counts={counts} role={role} />
      <main className="main">
        <div className="topbar">
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <span className="sep">/</span>}
                {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
              </span>
            ))}
          </div>
          <form className="search" onSubmit={submit}>
            <span style={{ display: "grid", placeItems: "center" }}><Icons.search /></span>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件・人材・会社を検索…（Enterで検索）" />
            <kbd>⌘K</kbd>
          </form>
          <button className="icon-btn" title="通知"><Icons.bell /><span className="dot" /></button>
          <span title="権限ロール" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: ROLE_BADGE[role].bg, color: ROLE_BADGE[role].fg, whiteSpace: "nowrap" }}>{ROLE_BADGE[role].label}</span>
          <OperatorBadge operators={operators} defaultName={defaultOperator} compact />
        </div>
        {children}
      </main>
    </div>
  );
}
