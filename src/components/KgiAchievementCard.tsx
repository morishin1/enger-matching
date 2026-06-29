"use client";

// ダッシュボード上部の「KGI達成率（チーム別）」カード。
//   ・KGIで最重要の【達成率】を、アウトサイド／インサイドで並べて常時表示（目標 vs 現在数値）。
//   ・アウトサイドのKGI＝稼働（合格）、インサイドのKGI＝面談（営業マニュアル §10／kpi-roles の役割定義）。
//   ・達成率は信号色（80%↑緑 / 50–80%黄 / 50%↓赤）。詳細な逆算ファネルは提案管理→KPI推移を参照。
type Funnel = {
  actual: { proposal: number; meeting: number; pass: number };
  target: { proposal: number; meeting: number; won: number };
  monthLabel?: string;
};
type FunnelsByRole = { all: Funnel; outside: Funnel; inside: Funnel };

function signal(pct: number | null): { fg: string; bg: string; bd: string } {
  if (pct == null) return { fg: "var(--color-ink-4)", bg: "var(--color-surface-inset)", bd: "var(--color-border)" };
  if (pct >= 80) return { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" };
  if (pct >= 50) return { fg: "#9a7b12", bg: "#fff6e0", bd: "#fde9b0" };
  return { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" };
}
const pctOf = (a: number, t: number): number | null => (t > 0 ? Math.round((a / t) * 100) : null);

export function KgiAchievementCard({ funnelsByRole }: { funnelsByRole?: FunnelsByRole | null }) {
  if (!funnelsByRole) return null;
  const monthLabel = funnelsByRole.all?.monthLabel ?? "今月";

  // 各チームのKGI（アウトサイド＝稼働 / インサイド＝面談）。目標は当月のファネル目標。
  const cards = [
    { key: "outside", label: "アウトサイド", kgi: "稼働（合格）", actual: funnelsByRole.outside.actual.pass, target: funnelsByRole.outside.target.won },
    { key: "inside", label: "インサイド", kgi: "面談", actual: funnelsByRole.inside.actual.meeting, target: funnelsByRole.inside.target.meeting },
  ] as const;

  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, color: "var(--color-ink-2)" }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>target</span>
          KGI達成率（チーム別）
        </span>
        <span className="muted" style={{ fontSize: 11 }}>{monthLabel}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {cards.map((c) => {
          const pct = pctOf(c.actual, c.target);
          const sig = signal(pct);
          const remain = Math.max(0, c.target - c.actual);
          return (
            <div key={c.key} style={{ borderRadius: 12, border: `1px solid ${sig.bd}`, background: sig.bg, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--color-ink)" }}>{c.label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--color-ink-4)" }}>KGI：{c.kgi}</span>
              </div>
              {/* 達成率（最重要）を大きく */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 900, lineHeight: 1, color: sig.fg, fontFamily: "var(--font-display)" }}>{pct == null ? "—" : `${pct}%`}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>達成率</span>
              </div>
              {/* 目標 と 現在数値 */}
              <div style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>
                現在 <b style={{ fontSize: 15, color: "var(--color-ink)" }}>{c.actual}</b>
                <span style={{ color: "var(--color-ink-4)" }}> / 目標 {c.target} 件</span>
                {remain > 0 && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>（残り{remain}件）</span>}
              </div>
              {/* 進捗バー */}
              <div style={{ height: 8, background: "rgba(15,23,42,.06)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, pct ?? 0)}%`, height: "100%", background: sig.fg, borderRadius: 99, transition: "width .3s ease" }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
        信号色＝達成率（<b style={{ color: "#067647" }}>80%↑緑</b>／<b style={{ color: "#9a7b12" }}>50–80%黄</b>／<b style={{ color: "#b42318" }}>50%↓赤</b>）。アウトサイドのKGIは<b>稼働（合格）</b>、インサイドは<b>面談</b>。提案→面談→合格→稼働の逆算ファネルは「提案管理 → KPI推移」で確認できます。
      </div>
    </div>
  );
}
