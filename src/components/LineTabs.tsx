"use client";

// LINE 登録ページの「人材 / 案件」タブ切り替え。サーバ側で描画した2セクションを
// slot で受け取り、display で出し分ける（state を保つため unmount しない）。
import { useState, type ReactNode } from "react";

export function LineTabs({ people, jobs, talk, peopleCount = 0, jobsCount = 0, talkCount = 0 }: {
  people: ReactNode; jobs: ReactNode; talk?: ReactNode; peopleCount?: number; jobsCount?: number; talkCount?: number;
}) {
  const [tab, setTab] = useState<"people" | "jobs" | "talk">("people");
  const tabs: { key: "people" | "jobs" | "talk"; label: string; icon: string; badge: number }[] = [
    { key: "people", label: "人材", icon: "person", badge: peopleCount },
    { key: "jobs", label: "案件", icon: "work", badge: jobsCount },
    ...(talk ? [{ key: "talk" as const, label: "トーク", icon: "chat", badge: talkCount }] : []),
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
              <span className="badge" style={{ fontSize: 10, padding: "1px 7px" }}>{t.badge}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: tab === "people" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{people}</div>
      <div style={{ display: tab === "jobs" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{jobs}</div>
      {talk && <div style={{ display: tab === "talk" ? "flex" : "none", flexDirection: "column", gap: 12 }}>{talk}</div>}
    </div>
  );
}
