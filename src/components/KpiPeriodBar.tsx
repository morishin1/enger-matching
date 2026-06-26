"use client";

// 提案管理「KPI推移」タブ上部の期間切り替えバー。
//   メンバー別アクティビティ／ステージ目標・KPI/KGI達成率の表に期間切替を効かせる。
//   URL の ?period を切り替えて再取得する（サーバ側 loadKpiClientProps が期間で集計）。
//   既定は「本日」。前日/今週/今月/四半期/任意（カレンダー）に切替可能。
import { useRouter, useSearchParams } from "next/navigation";

const PERIODS: { key: string; label: string }[] = [
  { key: "day", label: "本日" },
  { key: "yesterday", label: "前日" },
  { key: "week", label: "今週" },
  { key: "month", label: "今月" },
  { key: "quarter", label: "四半期" },
  { key: "custom", label: "任意（カレンダー）" },
];

export function KpiPeriodBar({ current }: { current?: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  // 既定（未指定）は本日(day)扱い。
  const active = current || sp?.get("period") || "day";

  const go = (key: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.set("period", key);
    if (key !== "custom") { u.delete("from"); u.delete("to"); } // 任意以外は日付指定をクリア
    router.push(`/proposals?${u.toString()}`);
  };

  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800 }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>calendar_month</span>
        期間
      </span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {PERIODS.map((p) => {
          const on = active === p.key;
          return (
            <button key={p.key} type="button" onClick={() => go(p.key)}
              style={{
                fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 800 : 600, cursor: "pointer",
                padding: "6px 14px", borderRadius: 99,
                border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
                background: on ? "var(--color-brand-600)" : "#fff", color: on ? "#fff" : "var(--color-ink-2)",
              }}>
              {p.label}
            </button>
          );
        })}
      </div>
      {active === "custom" && (
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>※「任意」は下のKPIダッシュボードの日付欄で範囲を指定してください。</span>
      )}
    </div>
  );
}
