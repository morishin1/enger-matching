"use client";

// チームKGIの編集フォーム（クライアント）。3指標を一度に編集して保存する。
//   行ごとに「下限〜上限・メモ」を入力。空欄＝未設定。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeamKgi } from "@/lib/team-kgi-actions";
import type { KgiMetric } from "@/lib/team-kgi";

type MetricDef = { key: KgiMetric; label: string; unit: string; hint: string };
type InitialRow = {
  metric: KgiMetric;
  target_min: number | null;
  target_max: number | null;
  note: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

type DraftRow = {
  metric: KgiMetric;
  min: string;
  max: string;
  note: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

const fmtDateTime = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function TeamKgiEditor({ department, month, metrics, initial }:
  { department: string; month: string; metrics: MetricDef[]; initial: InitialRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<KgiMetric | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const initialMap = new Map(initial.map((r) => [r.metric, r]));
  const [draft, setDraft] = useState<Record<KgiMetric, DraftRow>>(() => {
    const init: Record<string, DraftRow> = {};
    for (const m of metrics) {
      const r = initialMap.get(m.key);
      init[m.key] = {
        metric: m.key,
        min: r?.target_min != null ? String(r.target_min) : "",
        max: r?.target_max != null ? String(r.target_max) : "",
        note: r?.note ?? "",
        updatedAt: r?.updatedAt ?? null,
        updatedByName: r?.updatedByName ?? null,
      };
    }
    return init as Record<KgiMetric, DraftRow>;
  });

  const update = (key: KgiMetric, patch: Partial<DraftRow>) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  };

  const save = (key: KgiMetric) => {
    const row = draft[key];
    const min = row.min.trim() === "" ? null : Number(row.min);
    const max = row.max.trim() === "" ? null : Number(row.max);
    if (min != null && Number.isNaN(min)) { setMsg({ ok: false, text: "下限値は数値で入力してください" }); return; }
    if (max != null && Number.isNaN(max)) { setMsg({ ok: false, text: "上限値は数値で入力してください" }); return; }
    setMsg(null);
    setBusyKey(key);
    start(async () => {
      const res = await saveTeamKgi({
        department, month, metric: key,
        target_min: min, target_max: max,
        note: row.note.trim() || null,
      });
      setBusyKey(null);
      if (res.ok) {
        setMsg({ ok: true, text: `${labelOf(metrics, key)} を保存しました` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error || "保存に失敗しました" });
      }
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🎯 KGI（{department}・{month.slice(0, 7).replace("-", "年")}月）</h3>
        {msg && (
          <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>
            {msg.ok ? "✓ " : "⚠ "}{msg.text}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {metrics.map((m) => {
          const row = draft[m.key];
          const busy = pending && busyKey === m.key;
          const hasValue = row.min !== "" || row.max !== "";
          return (
            <div key={m.key} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 14, background: "var(--color-surface)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink)" }}>{m.label}</div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{m.hint}</div>
                </div>
                {row.updatedAt && (
                  <span className="muted" style={{ fontSize: 10.5 }}>
                    最終更新 {fmtDateTime(row.updatedAt)}{row.updatedByName ? ` ・ ${row.updatedByName}` : ""}
                  </span>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr auto", gap: 10, alignItems: "end" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta">下限</span>
                  <div style={{ position: "relative" }}>
                    <input type="number" inputMode="decimal" step="any" min={0}
                      value={row.min} onChange={(e) => update(m.key, { min: e.target.value })}
                      placeholder="—"
                      style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 38px 8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--color-ink-4)" }}>{m.unit}</span>
                  </div>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta">上限</span>
                  <div style={{ position: "relative" }}>
                    <input type="number" inputMode="decimal" step="any" min={0}
                      value={row.max} onChange={(e) => update(m.key, { max: e.target.value })}
                      placeholder="—"
                      style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 38px 8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--color-ink-4)" }}>{m.unit}</span>
                  </div>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="meta">メモ（任意）</span>
                  <input type="text" value={row.note} onChange={(e) => update(m.key, { note: e.target.value })}
                    placeholder="背景・補足など"
                    style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
                </label>
                <button type="button" className="btn brand" disabled={busy} onClick={() => save(m.key)} style={{ height: 36 }}>
                  {busy ? "保存中…" : "保存"}
                </button>
              </div>

              {hasValue && (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  目標：{row.min === "" ? "—" : row.min}{row.max !== "" && row.max !== row.min ? ` 〜 ${row.max}` : ""} {m.unit}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
        ※ 各指標は「下限」のみ入力すれば単一目標、「下限〜上限」で目標レンジを設定できます。空欄で削除はせず、未設定として扱われます（再度値を入れて保存で上書き）。
      </div>
    </div>
  );
}

function labelOf(defs: MetricDef[], key: KgiMetric): string {
  return defs.find((d) => d.key === key)?.label ?? key;
}
