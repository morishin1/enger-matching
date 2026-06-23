// エージェントメンバー向け：マネージャーから与えられた KGI/KPI を最上段で常時意識させるパネル。
//   ・🏁 今月の稼働化（KGI）／📣 今日の提案（日次KPI）／📅 今週の提案（週次KPI）
//   ・残り営業日・進捗％・1日あたり必要件数 を計算し『今日あと N件』を強調
//   ・ファネル(今日/今週/今月)で量だけでなく質も把握
//   ・KGI未設定なら『マネージャーに目標設定を依頼』を明示
//   getMyScorecard() の集計を再利用するためサーバー側で MeScorecard を作って渡す。

import Link from "@/components/AppLink";
import type { MeScorecard } from "@/lib/me-scorecard";
import { businessDaysInMonth, monthKey } from "@/lib/person-kgi";

// 今月の残り営業日（今日含む）
function remainingBusinessDays(now = new Date()): number {
  const y = now.getFullYear(), m = now.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  let n = 0;
  for (let d = now.getDate(); d <= last; d++) {
    const dow = new Date(y, m, d).getDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

function pct(done: number, target: number | null | undefined): number {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((done / target) * 100));
}

export function AgentGoalsHero({ name, s }: { name: string | null; s: MeScorecard }) {
  if (!s.available) return null;
  const now = new Date();
  const monthBizDays = businessDaysInMonth(monthKey(now));
  const remainBiz = remainingBusinessDays(now);

  // === 今月の稼働化（KGI） ===
  const kgi = s.placementTarget;
  const done = s.monthPlacedTotal;
  const remain = Math.max(0, (kgi ?? 0) - done);
  const kgiPct = pct(done, kgi);

  // === 今日の提案（日次KPI） ===
  const dayTarget = s.plan?.dailyProposals ?? null;
  const dayDone = s.today.proposal;
  const dayRemain = Math.max(0, (dayTarget ?? 0) - dayDone);
  const dayPct = pct(dayDone, dayTarget);

  // === 今週の提案（週次KPI） ===
  const weekTarget = s.plan?.weeklyProposals ?? null;
  const weekDone = s.week.proposal;
  const weekRemain = Math.max(0, (weekTarget ?? 0) - weekDone);
  const weekPct = pct(weekDone, weekTarget);

  // === 月次提案ペース（KGIから逆算した必要月間提案数に対する進捗）===
  const monthTarget = s.plan?.monthlyProposals ?? null;
  const monthDone = s.month.proposal;
  const monthPct = pct(monthDone, monthTarget);

  // ペース判定：このペースで月末まで行ったら目標到達できるか
  //   想定到達 = 1日平均(=月実績/経過営業日) × 月内営業日
  const elapsedBiz = Math.max(1, monthBizDays - remainBiz + 1);
  const projected = Math.round((monthDone / elapsedBiz) * monthBizDays);
  const onPace = monthTarget == null ? null : projected >= monthTarget;

  const noKgi = kgi == null || kgi <= 0;

  return (
    <div className="card" style={{ background: "linear-gradient(135deg, var(--color-brand-25), var(--color-surface) 70%)", border: "1px solid var(--color-brand-100)", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          {name ? `${name} さんの目標` : "今月の目標"}
        </h2>
        <span className="muted" style={{ fontSize: 11 }}>
          {now.getFullYear()}/{now.getMonth() + 1} ・ 残り営業日 <b style={{ color: "var(--color-ink)" }}>{remainBiz}</b> / {monthBizDays}日
          {s.conversion != null && <> ・ 全社転換率 {Math.round(s.conversion * 100)}%</>}
        </span>
      </div>

      {noKgi ? (
        <div style={{ background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 10, padding: "12px 14px", color: "#92400e", fontSize: 12.5, lineHeight: 1.7 }}>
          <b>個人KGIが未設定です。</b>マネージャーに「今月の稼働化目標」の設定を依頼してください。
          目標が入ると、ここに <b>今月の稼働化／今日の提案／今週の提案</b> が自動で出ます。
          <div style={{ marginTop: 6 }}>
            <Link href="/reports" style={{ color: "#9a3412", fontWeight: 700, textDecoration: "underline" }}>日報で進捗をメモする →</Link>
          </div>
        </div>
      ) : (
        <>
          {/* 3つの大目標カード */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 10 }}>
            <GoalCard
              icon="🏁"
              label="今月の稼働化（KGI）"
              done={done}
              target={kgi}
              unit="件"
              pct={kgiPct}
              tone="accent"
              hint={remain > 0 ? `残り ${remain}件 / 営業日 ${remainBiz}日` : "目標達成 🎉"}
            />
            <GoalCard
              icon="📣"
              label="今日の提案（日次KPI）"
              done={dayDone}
              target={dayTarget}
              unit="件"
              pct={dayPct}
              tone="brand"
              hint={dayTarget == null ? "—" : dayRemain > 0 ? `今日あと ${dayRemain}件` : "今日の目標達成 ✓"}
              big
            />
            <GoalCard
              icon="📅"
              label="今週の提案（週次KPI）"
              done={weekDone}
              target={weekTarget}
              unit="件"
              pct={weekPct}
              tone="neutral"
              hint={weekTarget == null ? "—" : weekRemain > 0 ? `今週あと ${weekRemain}件` : "週の目標達成 ✓"}
            />
          </div>

          {/* 月次ペース判定 */}
          {monthTarget != null && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", borderRadius: 8, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-3)" }}>📈 今月の提案ペース</span>
              <div style={{ flex: 1, minWidth: 120, height: 6, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
                <div style={{ width: `${monthPct}%`, height: "100%", background: onPace ? "#067647" : "#b45309", transition: "width .25s" }} />
              </div>
              <span className="mono" style={{ fontSize: 12, fontWeight: 800 }}>{monthDone}<span className="muted" style={{ fontWeight: 400 }}>/{monthTarget}</span></span>
              {onPace == null ? null : onPace ? (
                <span style={{ fontSize: 11, fontWeight: 800, color: "#067647", padding: "2px 9px", borderRadius: 99, background: "#e7f7ee", border: "1px solid #bfe3cc" }}>
                  ✓ このペースで達成見込み（想定 {projected}件）
                </span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 800, color: "#b45309", padding: "2px 9px", borderRadius: 99, background: "#fff6e0", border: "1px solid #fde9b0" }}>
                  ⚠ ペース不足（想定 {projected}件・目標 {monthTarget}件）
                </span>
              )}
            </div>
          )}

          {/* ファネル4段：量と質を把握 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 10 }}>
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

          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <Link href="/proposals" className="btn brand btn-xs" style={{ textDecoration: "none" }}>📊 提案管理を開く</Link>
            <Link href="/matching" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>🔄 マッチングで提案を増やす</Link>
            <Link href="/reports" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>📓 日報を書く（気づきと一手）</Link>
            <Link href="/funnel" className="muted" style={{ marginLeft: "auto", fontSize: 11, textDecoration: "underline", alignSelf: "center" }}>ファネル詳細 →</Link>
          </div>
        </>
      )}
    </div>
  );
}

const STAGES: { key: "proposal" | "meeting" | "cl" | "won"; label: string; tone: "brand" | "neutral" | "accent" }[] = [
  { key: "proposal", label: "提案", tone: "brand" },
  { key: "meeting",  label: "面談", tone: "neutral" },
  { key: "cl",       label: "クロージング", tone: "neutral" },
  { key: "won",      label: "稼働化", tone: "accent" },
];

function GoalCard({ icon, label, done, target, unit, pct, tone, hint, big }: {
  icon: string; label: string; done: number; target: number | null; unit: string;
  pct: number; tone: "brand" | "accent" | "neutral"; hint: string; big?: boolean;
}) {
  const color = tone === "accent" ? "#067647" : tone === "brand" ? "var(--color-brand-700)" : "var(--color-ink)";
  const bg = tone === "accent" ? "rgba(6,118,71,.06)" : tone === "brand" ? "var(--color-brand-25)" : "var(--color-surface)";
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--color-border)", background: bg }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span className="mono" style={{ fontSize: big ? 28 : 22, fontWeight: 800, color, lineHeight: 1 }}>{done}</span>
        <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>{unit}</span>
        {target != null && <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11.5 }}>/ {target}{unit}</span>}
      </div>
      <div style={{ height: 4, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", margin: "5px 0 4px" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .25s" }} />
      </div>
      <div className="muted" style={{ fontSize: 10.5, fontWeight: pct < 50 ? 700 : 500, color: pct < 30 ? "#b45309" : "var(--color-ink-3)" }}>{hint}</div>
    </div>
  );
}
