"use client";

import { useState } from "react";
import Link from "@/components/AppLink";

export type Issue = {
  id: string;
  sev: "high" | "mid" | "low" | "good";
  title: string;
  metric: string;          // 数値サマリ
  advice?: string;         // 改善の一手
  href?: string;           // 対応先
  hrefLabel?: string;
  items?: string[];        // 内訳（深掘り）
};

const SEV: Record<Issue["sev"], { dot: string; bg: string; label: string }> = {
  high: { dot: "#d23f57", bg: "#fdecef", label: "要対応" },
  mid: { dot: "#d98a2b", bg: "#fff5e6", label: "注意" },
  low: { dot: "#6b7280", bg: "#eef0f3", label: "監視" },
  good: { dot: "#1aa260", bg: "#e7f3ea", label: "良好" },
};

export function IssueBoard({ title, issues, category }: { title: string; issues: Issue[]; category: string }) {
  const [open, setOpen] = useState<string | null>(issues.find((i) => i.sev === "high")?.id ?? null);

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🔎 {title}</h3>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: "var(--color-surface-inset)", color: "var(--color-ink-3)" }}>{category}</span>
      </div>

      {issues.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>検出された課題はありません。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {issues.map((it) => {
            const s = SEV[it.sev];
            const isOpen = open === it.id;
            return (
              <div key={it.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : it.id)}
                  style={{ width: "100%", textAlign: "left", border: 0, background: isOpen ? s.bg : "var(--color-surface)", cursor: "pointer", padding: "11px 13px", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: s.dot, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{it.title}</span>
                    <span className="muted" style={{ fontSize: 11.5, marginLeft: 8 }}>{it.metric}</span>
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: s.dot, padding: "2px 8px", borderRadius: 999, background: s.bg, flexShrink: 0 }}>{s.label}</span>
                  <span style={{ color: "var(--color-ink-4)", fontSize: 13, flexShrink: 0 }}>{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div style={{ padding: "10px 13px", borderTop: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 8 }}>
                    {it.advice && <div style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>💡 {it.advice}</div>}
                    {it.items && it.items.length > 0 && (
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                        {it.items.slice(0, 8).map((x, i) => <li key={i} style={{ fontSize: 12, color: "var(--color-ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>・{x}</li>)}
                        {it.items.length > 8 && <li className="muted" style={{ fontSize: 11 }}>ほか {it.items.length - 8} 件</li>}
                      </ul>
                    )}
                    {it.href && <Link href={it.href} className="btn brand btn-xs" style={{ alignSelf: "flex-start", textDecoration: "none" }}>{it.hrefLabel ?? "深掘りする"} →</Link>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
