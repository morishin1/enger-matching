"use client";

// 企業管理ページのタブ切り替え。縦に長かった複数セクションをタブで分割し、
// スクロール量を減らす。サーバ側で描画した各セクションを slot として受け取り、
// display で出し分ける（state を保つため unmount しない）。
//   ・企業一覧        : CompaniesView（最頻用なので先頭・既定）
//   ・ターゲティング  : 狙うべき企業ボード＋担当者別決定率
//   ・フォロー/実績   : ご無沙汰フォロー＋提案ランキング

import { useState, type ReactNode } from "react";

type TabKey = "list" | "target" | "follow";

export function CompaniesTabs({ list, target, follow, followCount = 0 }: {
  list: ReactNode; target: ReactNode; follow: ReactNode; followCount?: number;
}) {
  const [tab, setTab] = useState<TabKey>("list");
  const tabs: { key: TabKey; label: string; icon: string; badge?: number }[] = [
    { key: "list",   label: "企業一覧",     icon: "domain" },
    { key: "target", label: "ターゲティング", icon: "target" },
    { key: "follow", label: "フォロー / 実績", icon: "history", badge: followCount || undefined },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", overflowX: "auto" }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              style={{
                padding: "10px 18px", background: "transparent", border: 0,
                borderBottom: active ? "2px solid var(--color-brand-600)" : "2px solid transparent",
                color: active ? "var(--color-brand-700)" : "var(--color-ink-3)",
                fontWeight: active ? 700 : 600, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
              }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.badge ? <span className="badge" style={{ fontSize: 10, padding: "1px 7px" }}>{t.badge}</span> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: tab === "list" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{list}</div>
      <div style={{ display: tab === "target" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{target}</div>
      <div style={{ display: tab === "follow" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{follow}</div>
    </div>
  );
}
