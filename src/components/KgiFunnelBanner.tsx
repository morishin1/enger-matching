"use client";

import { useState } from "react";

// KGI逆算ファネル（KPI推移タブの最上部に常時表示）。
//   営業マニュアル §10 準拠：提案 → 面談 → 合格 → 稼働 を当月(累計)の実績/目標で表示。
//   ・各ステージを信号色（緑80%↑/黄50-80%/赤50%↓）で着色。
//   ・矢印上に歩留まり率（面談率・合格率・稼働化率）を表示。
//   ・先頭に「稼働 ◯/目標（残り◯件・あと◯営業日）」を大きく出す。

type Funnel = {
  actual: { proposal: number; meeting: number; pass: number };
  target: { proposal: number; meeting: number; won: number };
  rates?: { meetingRate: number; passRate: number };
  bizPassed: number;
  bizTotal: number;
  monthLabel?: string;
};

// 達成率→信号色（しきい値：80%↑緑 / 50-80%黄 / 50%↓赤）。
function signal(pct: number | null): { fg: string; bg: string; bd: string } {
  if (pct == null) return { fg: "var(--color-ink-4)", bg: "var(--color-surface-inset)", bd: "var(--color-border)" };
  if (pct >= 80) return { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" };
  if (pct >= 50) return { fg: "#9a7b12", bg: "#fff6e0", bd: "#fde9b0" };
  return { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" };
}
const pctOf = (a: number, t: number): number | null => (t > 0 ? Math.round((a / t) * 100) : null);
const rate = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export function KgiFunnelBanner({ funnel }: { funnel?: Funnel | null }) {
  // 表示モード：累計（当月実績そのまま）／月末着地予測（累計 × 総営業日 ÷ 経過営業日）。
  const [mode, setMode] = useState<"cumulative" | "forecast">("cumulative");
  if (!funnel) return null;
  const a = funnel.actual, t = funnel.target;
  const factor = mode === "forecast" && (funnel.bizPassed ?? 0) > 0 ? (funnel.bizTotal ?? 0) / (funnel.bizPassed ?? 1) : 1;
  const proj = (n: number) => (mode === "forecast" ? Math.round(n * factor) : n);
  const dPass = proj(a.pass);
  const wonRemain = Math.max(0, t.won - dPass);
  const bizLeft = Math.max(0, (funnel.bizTotal ?? 0) - (funnel.bizPassed ?? 0));
  const wonPct = pctOf(dPass, t.won);
  const wonSig = signal(wonPct);

  // 4ステージ（合格＝稼働決定のため稼働の実績は合格と同値）。表示値はモードに応じて累計/着地予測。
  const stages = [
    { label: "提案", actual: proj(a.proposal), target: t.proposal },
    { label: "面談", actual: proj(a.meeting), target: t.meeting },
    { label: "合格", actual: dPass, target: t.won },
    { label: "稼働", actual: dPass, target: t.won },
  ];
  // 矢印上の歩留まり率（面談率・合格率・稼働化率）。
  const yields = [
    { label: "面談率", value: rate(a.meeting, a.proposal) },
    { label: "合格率", value: rate(a.pass, a.meeting) },
    { label: "稼働化率", value: rate(a.pass, a.pass) },
  ];

  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, background: "linear-gradient(180deg, var(--color-surface), var(--color-surface-soft))" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: "var(--color-ink-2)" }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>flag</span>
          KGI逆算ファネル
        </span>
        <span className="muted" style={{ fontSize: 11 }}>{funnel.monthLabel ?? "今月"}</span>
        {/* 累計 / 月末着地予測 トグル */}
        <span style={{ display: "inline-flex", gap: 2, background: "var(--color-surface-inset)", borderRadius: 99, padding: 2 }}>
          {([["cumulative", "累計"], ["forecast", "着地予測"]] as const).map(([k, lbl]) => (
            <button key={k} type="button" onClick={() => setMode(k)}
              style={{ fontFamily: "inherit", fontSize: 11, fontWeight: mode === k ? 800 : 600, cursor: "pointer", padding: "3px 10px", borderRadius: 99, border: 0,
                background: mode === k ? "var(--color-surface)" : "transparent", color: mode === k ? "var(--color-ink)" : "var(--color-ink-3)", boxShadow: mode === k ? "0 1px 2px rgba(15,23,42,.08)" : "none" }}>
              {lbl}
            </button>
          ))}
        </span>
        {/* 稼働 ◯/目標（残り・営業日） */}
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>KGI 稼働{mode === "forecast" ? "（着地予測）" : ""}</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: wonSig.fg, lineHeight: 1 }}>{dPass}<span style={{ fontSize: 13, color: "var(--color-ink-4)", fontWeight: 700 }}> / {t.won}</span></span>
          <span className="muted" style={{ fontSize: 11.5 }}>残り{wonRemain}件・あと{bizLeft}営業日</span>
        </span>
      </div>

      {/* 提案 → 面談 → 合格 → 稼働 */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, flexWrap: "wrap" }}>
        {stages.map((s, i) => {
          const pct = pctOf(s.actual, s.target);
          const sig = signal(pct);
          return (
            <div key={s.label} style={{ display: "flex", alignItems: "stretch" }}>
              <div style={{ minWidth: 92, textAlign: "center", borderRadius: 10, border: `1px solid ${sig.bd}`, background: sig.bg, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)" }}>{s.label}</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: sig.fg, lineHeight: 1.1 }}>{s.actual}<span style={{ fontSize: 11.5, color: "var(--color-ink-4)", fontWeight: 700 }}> / {s.target}</span></span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: sig.fg }}>{pct == null ? "—" : `${pct}%`}</span>
              </div>
              {i < stages.length - 1 && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 6px", minWidth: 64 }}>
                  <span style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap" }}>{yields[i].label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--color-ink-2)" }}>{yields[i].value}</span>
                  <span aria-hidden style={{ fontSize: 16, color: "var(--color-ink-4)", lineHeight: 0.8 }}>→</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
        信号色＝達成率（<b style={{ color: "#067647" }}>80%↑緑</b>／<b style={{ color: "#9a7b12" }}>50–80%黄</b>／<b style={{ color: "#b42318" }}>50%↓赤</b>）。目標は当月：提案{t.proposal}→面談{t.meeting}→合格{t.won}→稼働{t.won}（KPI＆KGIのファネル目標）。
        {mode === "forecast" && <>　<b>着地予測</b>＝当月累計 ×（総営業日{funnel.bizTotal} ÷ 経過{funnel.bizPassed}）。このペースが続いた場合の月末見込み。</>}
      </div>
    </div>
  );
}
