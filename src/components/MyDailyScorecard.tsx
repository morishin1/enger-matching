// 日報トップに置く「今日のスコアカード」。
//   ファネル4段（提案/面談/CL/稼働化）を 今日/今週/今月 で表示し、
//   逆算した「今日の提案目標」と「今月の稼働化進捗」を併記する。
//   これを毎日チェックすることで、活動量(KPI)と成果(KGI)が日次でつながる。

import Link from "next/link";
import type { MeScorecard } from "@/lib/me-scorecard";

type Tone = "brand" | "neutral" | "accent";
const STAGES: { key: "proposal" | "meeting" | "cl" | "won"; label: string; tone: Tone }[] = [
  { key: "proposal", label: "提案", tone: "brand" },
  { key: "meeting",  label: "面談", tone: "neutral" },
  { key: "cl",       label: "CL",   tone: "neutral" },
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
    { name: "面談→CL", r: rMC },
    { name: "CL→稼働化", r: rCW },
  ].filter((x) => x.r != null) as { name: string; r: number }[];
  const weakest = candidates.length > 0 ? candidates.reduce((a, b) => (b.r < a.r ? b : a)) : null;

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>🎯 今日のスコアカード</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          全社の総合転換率 {s.conversion == null ? "—" : `${Math.round(s.conversion * 100)}%`}
          <Link href="/funnel" style={{ marginLeft: 8, color: "var(--color-brand-700)", textDecoration: "none" }}>ファネル →</Link>
        </span>
      </div>

      {/* 上段：稼働化(月次KGI) と 提案(日次KPI) を大きく */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
        <BigGoal
          icon="🏁"
          label="今月の稼働化"
          done={monthPlacedDone}
          target={placementTarget}
          unit="件"
          pct={monthPlacedPct}
          tone="accent"
          hint={placementTarget == null ? "個人月次KGI 未設定（マネージャーへ）" : `KGI ${placementTarget}件 ／ 残り ${Math.max(0, placementTarget - monthPlacedDone)}件`}
        />
        <BigGoal
          icon="📣"
          label="今日の提案"
          done={todayPropDone}
          target={todayProposalTarget}
          unit="件"
          pct={todayPropPct}
          tone="brand"
          hint={todayProposalTarget == null ? "KGI未設定or転換率未算出のため逆算不可" : `日次KPI ${todayProposalTarget}件（月${s.plan?.monthlyProposals}・週${s.plan?.weeklyProposals}）`}
        />
      </div>

      {/* 中段：今日/今週/今月 のファネル4段表 */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--color-ink-4)", fontSize: 10.5 }}>
            <th style={{ padding: "5px 8px" }}>段階</th>
            <th style={{ padding: "5px 8px", textAlign: "right" }}>今日</th>
            <th style={{ padding: "5px 8px", textAlign: "right" }}>今週</th>
            <th style={{ padding: "5px 8px", textAlign: "right" }}>今月</th>
          </tr>
        </thead>
        <tbody>
          {STAGES.map((st) => (
            <tr key={st.key} style={{ borderTop: "1px solid var(--color-border)" }}>
              <td style={{ padding: "6px 8px", fontWeight: 700 }}>{st.label}</td>
              <td className="mono" style={{ padding: "6px 8px", textAlign: "right" }}>{s.today[st.key]}</td>
              <td className="mono" style={{ padding: "6px 8px", textAlign: "right" }}>{s.week[st.key]}</td>
              <td className="mono" style={{ padding: "6px 8px", textAlign: "right", fontWeight: 800, color: st.tone === "accent" ? "#067647" : st.tone === "brand" ? "var(--color-brand-700)" : "var(--color-ink)" }}>{s.month[st.key]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 下段：ボトルネック診断（定性気づきを書く起点） */}
      {weakest && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(217,119,6,.06)", border: "1px solid rgba(217,119,6,.25)" }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            🔎 今月の自分のボトルネックは <span style={{ color: "#b45309" }}>「{weakest.name}」</span>（{Math.round(weakest.r * 100)}%）
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
            この段の通過率を上げるには？ 下の「気づき」と「次の一手」に書いてみましょう。
          </div>
        </div>
      )}
      {placementTarget == null && (
        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          ※ 個人月次KGI（稼働化目標）が未設定です。マネージャーが <Link href="/settings/person-kgi" style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>設定画面</Link> で設定します。
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
    <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--color-border)", background: bg }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{done}</span>
        <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{unit}</span>
        {target != null && <span className="mono muted" style={{ marginLeft: "auto", fontSize: 12 }}>/ {target}{unit}</span>}
      </div>
      <div style={{ height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", marginBottom: 4 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s" }} />
      </div>
      <div className="muted" style={{ fontSize: 10.5 }}>{hint}</div>
    </div>
  );
}
