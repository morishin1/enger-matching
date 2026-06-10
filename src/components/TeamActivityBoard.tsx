"use client";

// メンバー別アクティビティ一覧（ダッシュボード／KPI推移 上部）。
//   指標は KPI推移と同じ5つ：提案 / コンタクト / 調整中 / 日程確定 / 成約。
//   各メンバーの「実績 / 目標」を表示し、チーム合計＋達成率を最下段に出す。
//   列ヘッダクリックで並び替え。提案以外は CL担当に加算される。

import { useMemo, useState } from "react";
import type { ActivityRow } from "@/lib/team-activity";
import { METRIC_LABELS, METRIC_ORDER, type Metric } from "@/lib/kpi";

type SortKey = Metric | "total";

export function TeamActivityBoard({ rows, periodLabel }: { rows: ActivityRow[]; periodLabel: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const valOf = (r: ActivityRow, k: SortKey) => k === "total" ? r.total : r.actual[k];
  const sorted = useMemo(() => [...rows].sort((a, b) => valOf(b, sortKey) - valOf(a, sortKey) || b.total - a.total), [rows, sortKey]);

  const totals = useMemo(() => {
    const act: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
    const tgt: Record<Metric, number> = { proposal: 0, contact: 0, adjusting: 0, schedule: 0, deal: 0 };
    for (const r of rows) for (const m of METRIC_ORDER) { act[m] += r.actual[m]; tgt[m] += r.target[m]; }
    const actTotal = METRIC_ORDER.reduce((s, m) => s + act[m], 0);
    const tgtTotal = METRIC_ORDER.reduce((s, m) => s + tgt[m], 0);
    return { act, tgt, actTotal, tgtTotal };
  }, [rows]);
  const max = useMemo(() => Math.max(1, ...rows.map((r) => r.total)), [rows]);

  const pct = (a: number, t: number) => t > 0 ? Math.round((a / t) * 100) : (a > 0 ? 100 : 0);
  const teamPct = pct(totals.actTotal, totals.tgtTotal);
  const teamTone = teamPct >= 100 ? "#067647" : teamPct >= 80 ? "#0095D9" : teamPct >= 50 ? "#b45309" : "#b42318";

  const th: React.CSSProperties = { textAlign: "right", padding: "8px 10px", cursor: "pointer", whiteSpace: "nowrap", fontWeight: 700, color: "var(--color-ink-3)" };

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-brand-700)" }}>groups</span>
          メンバー別アクティビティ（{periodLabel}）
        </h3>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span className="muted">チーム達成率</span>
          <b style={{ fontSize: 16, color: teamTone }}>{totals.tgtTotal > 0 ? `${teamPct}%` : "—"}</b>
          <span className="muted" style={{ fontSize: 11 }}>（{totals.actTotal} / {totals.tgtTotal || "—"}）</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>対象メンバーがいません。</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "var(--color-ink-3)" }}>メンバー</th>
                {METRIC_ORDER.map((m) => {
                  const on = sortKey === m; const tone = METRIC_LABELS[m].tone;
                  return (
                    <th key={m} onClick={() => setSortKey(m)} title="クリックで並び替え（実績 / 目標）"
                      style={{ ...th, fontWeight: on ? 800 : 700, color: on ? tone : "var(--color-ink-3)" }}>
                      {METRIC_LABELS[m].short}{on ? " ▾" : ""}
                    </th>
                  );
                })}
                <th onClick={() => setSortKey("total")} style={{ ...th, fontWeight: sortKey === "total" ? 800 : 700, color: sortKey === "total" ? "#0F2440" : "var(--color-ink-3)" }}>合計{sortKey === "total" ? " ▾" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.email ?? r.name} style={{ borderBottom: "1px solid var(--color-border)", background: i === 0 && sortKey === "total" && r.total > 0 ? "var(--color-brand-25)" : undefined }}>
                  <td style={{ padding: "8px 10px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {i === 0 && sortKey === "total" && r.total > 0 && <span style={{ marginRight: 4 }}>🏆</span>}
                    {r.name}
                  </td>
                  {METRIC_ORDER.map((m) => {
                    const a = r.actual[m]; const t = r.target[m]; const tone = METRIC_LABELS[m].tone;
                    const hit = t > 0 && a >= t;
                    return (
                      <td key={m} style={{ padding: "8px 10px", textAlign: "right" }}>
                        <span className="mono" style={{ fontWeight: a > 0 ? 700 : 400, color: hit ? "#067647" : a > 0 ? tone : "var(--color-ink-4)" }}>{a || "·"}</span>
                        {t > 0 && <span className="mono" style={{ color: "var(--color-ink-4)", fontSize: 10.5 }}> /{t}</span>}
                      </td>
                    );
                  })}
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <div style={{ flex: 1, maxWidth: 80, height: 6, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${Math.round((r.total / max) * 100)}%`, height: "100%", background: "#0F2440", borderRadius: 99 }} />
                      </div>
                      <span className="mono" style={{ fontWeight: 800, minWidth: 20 }}>{r.total}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--color-border)", fontWeight: 800, background: "var(--color-surface-soft)" }}>
                <td style={{ padding: "8px 10px", color: "var(--color-ink-2)" }}>チーム合計</td>
                {METRIC_ORDER.map((m) => (
                  <td key={m} style={{ padding: "8px 10px", textAlign: "right" }} className="mono">
                    {totals.act[m]}{totals.tgt[m] > 0 && <span style={{ color: "var(--color-ink-4)", fontSize: 10.5 }}> /{totals.tgt[m]}</span>}
                  </td>
                ))}
                <td style={{ padding: "8px 10px", textAlign: "right" }} className="mono">
                  {totals.actTotal}{totals.tgtTotal > 0 && <span style={{ color: teamTone, fontSize: 11 }}> （{teamPct}%）</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.6 }}>
        ※ 各セルは「実績 / 目標」。提案=新規提案（提案者）。コンタクト/調整中/日程確定/成約は<b>CL担当</b>に加算（架電・通知・面談・合格に連動）。
        目標は各メンバーの週次目標を期間に按分。チーム達成率＝メンバー実績合計 ÷ メンバー目標合計。
      </div>
    </div>
  );
}
