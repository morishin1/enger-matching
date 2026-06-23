// 日報トップに置く「今日のスコアカード」。
//   ファネル4段（提案/面談/CL/稼働化）を 今日/今週/今月 で表示し、
//   逆算した「今日の提案目標」と「今月の稼働化進捗」を併記する。
//   これを毎日チェックすることで、活動量(KPI)と成果(KGI)が日次でつながる。

import Link from "@/components/AppLink";
import type { MeScorecard } from "@/lib/me-scorecard";

type Tone = "brand" | "neutral" | "accent";
const STAGES: { key: "proposal" | "meeting" | "cl" | "won"; label: string; tone: Tone }[] = [
  { key: "proposal", label: "提案", tone: "brand" },
  { key: "meeting",  label: "面談", tone: "neutral" },
  { key: "cl",       label: "クロージング", tone: "neutral" },
  { key: "won",      label: "稼働化", tone: "accent" },
];

export function MyDailyScorecard({ s }: { s: MeScorecard }) {
  if (!s.available) return null;
  const todayProposalTarget = s.plan?.dailyProposals ?? null;
  const todayPropDone = s.today.proposal;
  const todayPropPct = todayProposalTarget ? Math.min(100, Math.round((todayPropDone / todayProposalTarget) * 100)) : 0;

  const monthPlacedDone = s.monthPlacedTotal;
  const placementTarget = s.placementTarget ?? null;
  const monthPlacedPct = placementTarget ? Math.min(100, Math.round((monthPlacedDone / placementTarget) * 100)) : 0;

  // ボトルネック（今月）：転換が最も鈍い段。表示用。
  const m = s.month;
  const rPM = m.proposal > 0 ? m.meeting / m.proposal : null;
  const rMC = m.meeting > 0 ? m.cl / m.meeting : null;
  const rCW = m.cl > 0 ? m.won / m.cl : null;
  const candidates = [
    { name: "提案→面談", r: rPM },
    { name: "面談→クロージング", r: rMC },
    { name: "クロージング→稼働化", r: rCW },
  ].filter((x) => x.r != null) as { name: string; r: number }[];
  const weakest = candidates.length > 0 ? candidates.reduce((a, b) => (b.r < a.r ? b : a)) : null;

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 800 }}>🎯 今日のスコアカード</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          総合転換率 {s.conversion == null ? "—" : `${Math.round(s.conversion * 100)}%`}
          {weakest && <> ・ ボトルネック <span style={{ color: "#b45309", fontWeight: 700 }}>{weakest.name}（{Math.round(weakest.r * 100)}%）</span></>}
          <Link href="/funnel" style={{ marginLeft: 8, color: "var(--color-brand-700)", textDecoration: "none" }}>ファネル →</Link>
        </span>
      </div>

      {/* KGI/KPI を横に2枚 + 下にファネル4段ピル：縦量を圧縮 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <BigGoal
          icon="🏁"
          label="今月の稼働化"
          done={monthPlacedDone}
          target={placementTarget}
          unit="件"
          pct={monthPlacedPct}
          tone="accent"
          hint={placementTarget == null ? "個人KGI未設定（マネージャーへ）" : `残り ${Math.max(0, placementTarget - monthPlacedDone)}件`}
        />
        <BigGoal
          icon="📣"
          label="今日の提案"
          done={todayPropDone}
          target={todayProposalTarget}
          unit="件"
          pct={todayPropPct}
          tone="brand"
          hint={todayProposalTarget == null ? "KGI/転換率未算出" : `月${s.plan?.monthlyProposals}・週${s.plan?.weeklyProposals}・日${todayProposalTarget}`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {STAGES.map((st) => {
          const color = st.tone === "accent" ? "#067647" : st.tone === "brand" ? "var(--color-brand-700)" : "var(--color-ink)";
          return (
            <div key={st.key} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--color-ink-4)", marginBottom: 2 }}>{st.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="mono" style={{ fontSize: 17, fontWeight: 800, color, lineHeight: 1 }}>{s.month[st.key]}</span>
                <span className="muted" style={{ fontSize: 10 }}>月</span>
                <span className="muted mono" style={{ marginLeft: "auto", fontSize: 10.5 }}>週{s.week[st.key]} / 日{s.today[st.key]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {placementTarget == null && (
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>
          ※ 個人月次KGI未設定。マネージャーが <Link href="/settings/person-kgi" style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>設定画面</Link> で設定します。
        </div>
      )}
    </div>
  );
}

function BigGoal({ icon, label, done, target, unit, pct, tone, hint }:
  { icon: string; label: string; done: number; target: number | null; unit: string; pct: number; tone: Tone; hint: string }) {
  const color = tone === "accent" ? "#067647" : tone === "brand" ? "var(--color-brand-700)" : "var(--color-ink)";
  const bg = tone === "accent" ? "rgba(6,118,71,.06)" : tone === "brand" ? "var(--color-brand-25)" : "var(--color-surface)";
  return (
    <div style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--color-border)", background: bg }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 2 }}>{icon} {label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{done}</span>
        <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>{unit}</span>
        {target != null && <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>/ {target}{unit}</span>}
      </div>
      <div style={{ height: 4, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", margin: "4px 0 2px" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s" }} />
      </div>
      <div className="muted" style={{ fontSize: 10 }}>{hint}</div>
    </div>
  );
}
