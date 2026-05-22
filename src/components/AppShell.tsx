"use client";

import { usePathname } from "next/navigation";
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
  "/pipeline": ["ENGER", "パイプライン"],
  "/analytics": ["ENGER", "分析"],
  "/inbox": ["ENGER", "受信箱"],
  "/ai": ["ENGER", "AIアシスタント"],
  "/settings": ["ENGER", "設定"],
};

export function AppShell({ children, counts }: { children: React.ReactNode; counts?: SidebarCounts }) {
  const pathname = usePathname();
  const key = pathname === "/" ? "/" : "/" + pathname.split("/")[1];
  const crumbs = CRUMBS[key] ?? ["ENGER"];

  return (
    <div className="app">
      <Sidebar counts={counts} />
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
          <div className="search">
            <span style={{ display: "grid", placeItems: "center" }}><Icons.search /></span>
            <input placeholder="案件・人材・会社を検索…" />
            <kbd>⌘K</kbd>
          </div>
          <button className="icon-btn" title="通知"><Icons.bell /><span className="dot" /></button>
          <button className="icon-btn" title="新規"><Icons.plus /></button>
        </div>
        {children}
      </main>
    </div>
  );
}
