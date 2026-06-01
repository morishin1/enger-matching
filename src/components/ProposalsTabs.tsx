"use client";

import { useState, type ReactNode } from "react";

type TabKey = "board" | "history" | "lost";

export function ProposalsTabs({
  board,
  history,
  lostSummary,
  boardCount,
  historyCount,
  lostCount,
}: {
  board: ReactNode;
  history?: ReactNode | null;
  lostSummary?: ReactNode | null;
  boardCount: number;
  historyCount: number;
  lostCount: number;
}) {
  const [tab, setTab] = useState<TabKey>("board");
  const tabs: { key: TabKey; label: string; icon: string; count: number; show: boolean; title?: string }[] = [
    { key: "board",   label: "提案ボード", icon: "view_kanban", count: boardCount,   show: true, title: "進行中の提案件数（返信待ち〜面談合格の合計）。見送り/失注/稼働済みは除外。" },
    { key: "lost",    label: "失注分析",   icon: "monitoring",  count: lostCount,    show: !!lostSummary, title: "見送り/失注の合計件数" },
    { key: "history", label: "過去の提案", icon: "history",     count: historyCount, show: !!history, title: "見送り/失注/稼働化した提案の累計（直近200件まで表示）" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)" }}>
        {tabs.filter((t) => t.show).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.title}
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 18px",
                background: "transparent",
                border: 0,
                borderBottom: active ? "2px solid var(--color-brand-600)" : "2px solid transparent",
                color: active ? "var(--color-brand-700)" : "var(--color-ink-3)",
                fontWeight: active ? 700 : 600,
                fontSize: 13.5,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                whiteSpace: "nowrap",
              }}
            >
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
              <span>{t.label}</span>
              {t.count > 0 && (
                <span className="badge" style={{ fontSize: 10, padding: "1px 7px" }}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {/* タブ切替で子コンポーネントの状態(展開/編集中等)を保持するため display で出し分け */}
      <div style={{ display: tab === "board" ? "block" : "none" }}>{board}</div>
      {history && <div style={{ display: tab === "history" ? "block" : "none" }}>{history}</div>}
      {lostSummary && <div style={{ display: tab === "lost" ? "block" : "none" }}>{lostSummary}</div>}
    </div>
  );
}
