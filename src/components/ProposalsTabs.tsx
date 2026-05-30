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
  const tabs: { key: TabKey; label: string; count: number; show: boolean }[] = [
    { key: "board",   label: "📋 提案ボード", count: boardCount,   show: true },
    { key: "history", label: "📜 過去の提案", count: historyCount, show: !!history },
    { key: "lost",    label: "💔 失注理由",   count: lostCount,    show: !!lostSummary },
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
