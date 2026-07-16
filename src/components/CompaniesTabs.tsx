"use client";

// 企業管理ページのタブ切り替え。縦に長かった複数セクションをタブで分割し、
// スクロール量を減らす。サーバ側で描画した各セクションを slot として受け取り、
// display で出し分ける（state を保つため unmount しない）。
//   ・企業一覧        : CompaniesView（最頻用なので先頭・既定）
//   ・ターゲティング  : 狙うべき企業ボード＋担当者別決定率
//   ・フォロー/実績   : ご無沙汰フォロー＋提案ランキング

import { useState, type ReactNode } from "react";

type TabKey = "list" | "new" | "target" | "follow";

export function CompaniesTabs({ list, target, follow, newRegs, followCount = 0, newCount = 0, initialTab }: {
  list: ReactNode; target: ReactNode; follow: ReactNode;
  /** 新着（エンジャービジネス経由の企業新規登録）タブの中身。 */
  newRegs?: ReactNode; followCount?: number; newCount?: number; initialTab?: TabKey;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? "list");
  const tabs: { key: TabKey; label: string; icon: string; badge?: number; hot?: boolean }[] = [
    { key: "list",   label: "企業一覧",     icon: "domain" },
    // 新着＝エンジャービジネス（enger.jp 法人登録）からの承認待ち企業。件数は赤バッジで表示。
    { key: "new",    label: "新着",         icon: "fiber_new", badge: newCount || undefined, hot: true },
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
              {t.badge ? <span className={"badge" + (t.hot ? " hot" : "")} style={{ fontSize: 10, padding: "1px 7px" }}>{t.badge}</span> : null}
            </button>
          );
        })}
      </div>
      <div style={{ display: tab === "list" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{list}</div>
      <div style={{ display: tab === "new" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{newRegs}</div>
      <div style={{ display: tab === "target" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{target}</div>
      <div style={{ display: tab === "follow" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{follow}</div>
    </div>
  );
}
