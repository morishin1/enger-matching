"use client";

// ダッシュボードの「登録数・KPIの推移」グラフ。
//   フリーランス登録／人材登録／案件登録／提案／成約 の時系列を
//   週次（12週）・月次（12ヶ月）で切り替えて小型ラインチャートで表示する。
//   外部チャートライブラリは使わず SVG で描画（軽量・依存なし）。

import { useState } from "react";
import type { TrendData, TrendSeries } from "@/lib/trends";

function LineChart({ values, labels, color }: { values: number[]; labels: string[]; color: string }) {
  const W = 560, H = 120, PAD_L = 30, PAD_R = 10, PAD_T = 10, PAD_B = 22;
  const iw = W - PAD_L - PAD_R, ih = H - PAD_T - PAD_B;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD_T + ih - (v / max) * ih;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const area = `${PAD_L},${PAD_T + ih} ${pts} ${x(n - 1)},${PAD_T + ih}`;
  // Y軸目盛（0 / 中間 / 最大）
  const yTicks = [0, Math.round(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="推移グラフ">
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--color-border, #e5e9f0)" strokeWidth={1} strokeDasharray={i === 0 ? undefined : "3 4"} />
          <text x={PAD_L - 5} y={y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--color-ink-4, #98a2b3)">{v.toLocaleString("ja-JP")}</text>
        </g>
      ))}
      <polygon points={area} fill={color} opacity={0.08} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={i === n - 1 ? 3.6 : 2} fill={i === n - 1 ? color : "#fff"} stroke={color} strokeWidth={1.4}>
          <title>{`${labels[i]}：${v.toLocaleString("ja-JP")}件`}</title>
        </circle>
      ))}
      {/* X軸ラベル（最初・中間・最後） */}
      {[0, Math.floor((n - 1) / 2), n - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={9.5} fill="var(--color-ink-4, #98a2b3)">{labels[i]}</text>
      ))}
    </svg>
  );
}

function SeriesCard({ s, mode, labels }: { s: TrendSeries; mode: "weekly" | "monthly"; labels: string[] }) {
  const values = mode === "weekly" ? s.weekly : s.monthly;
  const cur = mode === "weekly" ? s.thisWeek : s.thisMonth;
  const prev = values.length >= 2 ? values[values.length - 2] : 0;
  const diff = cur - prev;
  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
        <b style={{ fontSize: 13 }}>{s.label}</b>
        <span className="tnum" style={{ fontSize: 20, fontWeight: 800, marginLeft: "auto", color: "var(--color-ink)" }}>{cur.toLocaleString("ja-JP")}</span>
        <span className="muted" style={{ fontSize: 11 }}>{mode === "weekly" ? "今週" : "今月"}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: diff >= 0 ? "#067647" : "#b42318" }}>
          {diff >= 0 ? "＋" : "−"}{Math.abs(diff).toLocaleString("ja-JP")}（前{mode === "weekly" ? "週" : "月"}比）
        </span>
      </div>
      <LineChart values={values} labels={labels} color={s.color} />
      <div className="muted" style={{ fontSize: 10.5 }}>直近12ヶ月合計 {s.total12m.toLocaleString("ja-JP")} 件</div>
    </div>
  );
}

export function TrendBoard({ data }: { data: TrendData }) {
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  const labels = mode === "weekly" ? data.weekLabels : data.monthLabels;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-brand-700)" }}>monitoring</span>
        <b style={{ fontSize: 15 }}>登録数・KPIの推移</b>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {([["weekly", "週次（12週）"], ["monthly", "月次（12ヶ月）"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)}
              className={mode === k ? "btn brand btn-xs" : "btn ghost btn-xs"}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        {data.series.map((s) => <SeriesCard key={s.key} s={s} mode={mode} labels={labels} />)}
      </div>
      <div className="muted" style={{ fontSize: 10.5 }}>
        集計対象：フリーランス登録（enger.jp）・人材登録（人材マスタ）・案件登録・提案（マッチングレコード）・成約/稼働。1時間ごとに自動更新。
      </div>
    </div>
  );
}
