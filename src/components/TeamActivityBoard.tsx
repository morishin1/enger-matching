"use client";

// メンバー別アクティビティ一覧（KPIダッシュボード上部）。
//   「誰が何をやったか」を一目で：提案 / 面談 / 人材登録 / 案件登録 / 稼働化 を期間で集計表示。
//   列クリックで並び替え。合計列の多い順を既定にし、動きが見える化される。

import { useMemo, useState } from "react";
import type { ActivityRow } from "@/lib/team-activity";

type Key = "proposals" | "meetings" | "candRegs" | "jobRegs" | "won" | "total";
const COLS: { key: Key; label: string; tone: string }[] = [
  { key: "proposals", label: "提案",     tone: "#0095D9" },
  { key: "meetings",  label: "面談",     tone: "#b45309" },
  { key: "candRegs",  label: "人材登録", tone: "#7c3aed" },
  { key: "jobRegs",   label: "案件登録", tone: "#0e7490" },
  { key: "won",       label: "稼働化",   tone: "#067647" },
  { key: "total",     label: "合計",     tone: "#0F2440" },
];

export function TeamActivityBoard({ rows, periodLabel }: { rows: ActivityRow[]; periodLabel: string }) {
  const [sortKey, setSortKey] = useState<Key>("total");
  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey] || b.total - a.total), [rows, sortKey]);
  const totals = useMemo(() => {
    const t = { proposals: 0, meetings: 0, candRegs: 0, jobRegs: 0, won: 0, total: 0 };
    for (const r of rows) for (const c of COLS) t[c.key] += r[c.key];
    return t;
  }, [rows]);
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.total)), [rows]);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-brand-700)" }}>groups</span>
          メンバー別アクティビティ（{periodLabel}）
        </h3>
        <span className="muted" style={{ fontSize: 11 }}>誰が何をやったか・列ヘッダで並び替え</span>
      </div>

      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>対象メンバーがいません。</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "var(--color-ink-3)" }}>メンバー</th>
                {COLS.map((c) => {
                  const on = sortKey === c.key;
                  return (
                    <th key={c.key} onClick={() => setSortKey(c.key)} title="クリックで並び替え"
                      style={{ textAlign: "right", padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: on ? 800 : 700, color: on ? c.tone : "var(--color-ink-3)" }}>
                      {c.label}{on ? " ▾" : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.email ?? r.name} style={{ borderBottom: "1px solid var(--color-border)", background: i === 0 && sortKey === "total" && r.total > 0 ? "var(--color-brand-25)" : undefined }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {i === 0 && sortKey === "total" && r.total > 0 && <span style={{ marginRight: 4 }}>🏆</span>}
                    {r.name}
                  </td>
                  {COLS.map((c) => {
                    const v = r[c.key];
                    const isTotal = c.key === "total";
                    return (
                      <td key={c.key} style={{ padding: "8px 10px", textAlign: "right", position: "relative" }}>
                        {isTotal ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                            <div style={{ flex: 1, maxWidth: 90, height: 6, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
                              <div style={{ width: `${Math.round((r.total / max) * 100)}%`, height: "100%", background: c.tone, borderRadius: 99 }} />
                            </div>
                            <span className="mono" style={{ fontWeight: 800, minWidth: 20, color: "var(--color-ink)" }}>{v}</span>
                          </div>
                        ) : (
                          <span className="mono" style={{ fontWeight: v > 0 ? 700 : 400, color: v > 0 ? c.tone : "var(--color-ink-4)" }}>{v || "·"}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 800 }}>
                <td style={{ padding: "8px 10px", color: "var(--color-ink-3)" }}>合計</td>
                {COLS.map((c) => (
                  <td key={c.key} style={{ padding: "8px 10px", textAlign: "right" }} className="mono">{totals[c.key]}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
        ※ 提案=新規提案（作成者）／面談=打合せ担当／人材・案件登録=取込担当（operator）／稼働化=稼働決定（提案者+クローザー）。担当名は略称でも本人に集計されます。
      </div>
    </div>
  );
}
