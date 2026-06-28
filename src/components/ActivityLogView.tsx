"use client";

import { useMemo, useState } from "react";
import type { ActivityLog } from "@/lib/activity-logs";

// 操作ログ一覧（担当者・日時・内容）。設定「ログ」タブで表示。
//   ・フリーワード（担当者/操作/対象/詳細）で絞り込み。
//   ・操作種別チップで絞り込み。

const fmtDateTime = (s: string) => {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 操作種別ごとの色（一目で削除/編集を見分ける）。
function actionTone(action: string): { bg: string; fg: string } {
  if (action.includes("削除")) return { bg: "#fdecef", fg: "#b42318" };
  if (action.includes("ステージ")) return { bg: "#e7f2fd", fg: "#0b5cab" };
  if (action.includes("編集")) return { bg: "#fff6e0", fg: "#9a7b12" };
  return { bg: "var(--color-surface-inset)", fg: "var(--color-ink-3)" };
}

export function ActivityLogView({ logs, available }: { logs: ActivityLog[]; available: boolean }) {
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("");

  // 操作種別の一覧（チップ用）。出現順・件数つき。
  const actions = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs) m.set(l.action, (m.get(l.action) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const filtered = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return logs.filter((l) => {
      if (actionFilter && l.action !== actionFilter) return false;
      if (!nq) return true;
      const hay = [l.operator, l.operator_email, l.action, l.target_label, l.target_id, l.detail].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(nq);
    });
  }, [logs, q, actionFilter]);

  if (!available) {
    return (
      <div className="card" style={{ padding: 16, fontSize: 12.5, color: "#9a7b12", background: "#fff6e0", border: "1px solid #fde9b0" }}>
        操作ログ用テーブルが未作成です。中央 Supabase の SQL Editor で <span className="mono">supabase/activity-logs.sql</span> を実行してください。
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 絞り込み */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="担当者・操作・対象・詳細で絞り込み…"
          style={{ flex: "1 1 240px", minWidth: 0, fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", fontFamily: "inherit" }} />
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{filtered.length} / {logs.length} 件</span>
      </div>
      {actions.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setActionFilter("")}
            className="tag" style={{ cursor: "pointer", fontSize: 11, border: 0, background: actionFilter === "" ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: actionFilter === "" ? "#fff" : "var(--color-ink-3)" }}>すべて</button>
          {actions.map(([a, n]) => (
            <button key={a} type="button" onClick={() => setActionFilter(actionFilter === a ? "" : a)}
              className="tag" style={{ cursor: "pointer", fontSize: 11, border: 0, background: actionFilter === a ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: actionFilter === a ? "#fff" : "var(--color-ink-3)" }}>{a}（{n}）</button>
          ))}
        </div>
      )}

      {/* テーブル */}
      {filtered.length === 0 ? (
        <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>{logs.length === 0 ? "まだ操作ログはありません。" : "該当するログはありません。"}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-ink-3)" }}>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>日時</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>担当者</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>操作</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>対象</th>
                <th style={{ padding: "6px 8px", borderBottom: "1px solid var(--color-border)" }}>詳細</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const tone = actionTone(l.action);
                return (
                  <tr key={l.id}>
                    <td className="mono" style={{ padding: "6px 8px", borderBottom: "1px dashed var(--color-border)", whiteSpace: "nowrap", color: "var(--color-ink-3)" }}>{fmtDateTime(l.created_at)}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px dashed var(--color-border)", whiteSpace: "nowrap", fontWeight: 600 }} title={l.operator_email ?? ""}>{l.operator ?? "—"}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px dashed var(--color-border)", whiteSpace: "nowrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: tone.bg, color: tone.fg }}>{l.action}</span>
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px dashed var(--color-border)", color: "var(--color-ink-2)" }}>{l.target_label ?? (l.target_id ? <span className="mono muted">{l.target_id}</span> : "—")}</td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px dashed var(--color-border)", color: "var(--color-ink-3)", whiteSpace: "pre-wrap" }}>{l.detail ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ fontSize: 10.5 }}>※ 直近500件まで表示。提案の削除・編集・ステージ変更を記録します。</div>
    </div>
  );
}
