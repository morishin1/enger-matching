"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Icons } from "./icons";
import type { SidebarCounts } from "@/lib/counts";

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
};

export function AppShell({ children, counts, operators, defaultOperator }: { children: React.ReactNode; counts?: SidebarCounts; operators?: string[]; defaultOperator?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  // ログイン画面はシェル(サイドバー/トップバー)なしで表示
  if (pathname === "/login") return <>{children}</>;

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
      <Sidebar counts={counts} operators={operators} defaultOperator={defaultOperator} />
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
          <button className="icon-btn" title="新規"><Icons.plus /></button>
        </div>
        {children}
      </main>
    </div>
  );
}
