import type { EntityDelta } from "@/lib/import-stats";

/** 案件/人材ページの見出し直下に出す「新規の増加（1/7/30日＋累計）」コンパクト表示。 */
export function EntityGrowthLine({ unit, delta }: { unit: string; delta: EntityDelta }) {
  const plus = (n: number) => (n > 0 ? { color: "#067647", fontWeight: 700 } : { color: "var(--color-ink-4)" });
  const n = (v: number) => v.toLocaleString("ja-JP");
  return (
    <div className="sub" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <span>累計 <b style={{ color: "var(--color-ink)" }}>{n(delta.total)} {unit}</b></span>
      <span className="muted" style={{ fontSize: 12 }}>新規：</span>
      <span style={plus(delta.d1)}>+{n(delta.d1)}<span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> 1日</span></span>
      <span style={plus(delta.d7)}>+{n(delta.d7)}<span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> 7日</span></span>
      <span style={plus(delta.d30)}>+{n(delta.d30)}<span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> 30日</span></span>
      <a href="/" style={{ color: "var(--color-brand-700,#0b5cab)", fontWeight: 600, textDecoration: "none", fontSize: 12 }}>ダッシュボードで全体を見る →</a>
    </div>
  );
}
