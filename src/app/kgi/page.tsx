// KGI/KPI ダッシュボード（管理NO：新規）。
//   月次KGI（売上/粗利）を「営業日ベース」で週次・日次に分解し、進捗率・ペース・リカバリー必要額を可視化。
//   ・KGI目標：enger.team_kgi（部署×月）の projectKgi を全社合算（売上=目標稼働数×単価/名, 粗利=×粗利/名）。
//   ・KGI実績：enger.engagements の当月稼働の月額合計（売上）。粗利は原価が見える権限のみ。
//   ・KPI先行指標：getKpiSnapshot（提案/架電/面談/合格の今月 実績/目標）＋ 週次目標を日割りした「1日あたり目標」。
//   ※ 初版は全社ビュー。部署別・個人別・カレンダー日次推移・SFA連携は今後の拡張。
import type { CSSProperties, ReactNode } from "react";
import Link from "@/components/AppLink";
import { currentAccess } from "@/lib/accounts";
import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";
import { projectKgi } from "@/lib/team-kgi";
import { businessDaysInMonth } from "@/lib/person-kgi";
import {
  getKpiSnapshot, getWeeklyTargets, scaleWeeklyTarget, resolveRange,
  businessDaysInRange, jstStartOfDay, jstStartOfWeek, addDays, type Metric,
} from "@/lib/kpi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const KGI_KPI_METRICS: { key: Metric; label: string }[] = [
  { key: "proposal", label: "提案" },
  { key: "contact", label: "架電・接触" },
  { key: "schedule", label: "面談" },
  { key: "deal", label: "合格（稼働決定）" },
];

const toneOf = (pct: number | null) =>
  pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 80 ? "#0095D9" : pct >= 50 ? "#b45309" : "#b42318";
const man = (n: number) => `${Math.round(n).toLocaleString("ja-JP")}万`;
const pctOf = (actual: number, target: number): number | null => (target > 0 ? Math.round((actual / target) * 100) : (actual > 0 ? 100 : null));
const two = (n: number) => String(n).padStart(2, "0");

function StatCard({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, letterSpacing: ".04em" }}>{label}</div>
      <div>{children}</div>
      {foot && <div className="muted" style={{ fontSize: 11 }}>{foot}</div>}
    </div>
  );
}

function Gauge({ pct }: { pct: number | null }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const tone = toneOf(pct);
  return (
    <div style={{ width: 104, height: 104, borderRadius: "50%", background: `conic-gradient(${tone} ${p * 3.6}deg, var(--color-surface-inset) 0)`, display: "grid", placeItems: "center", flexShrink: 0 }}>
      <div style={{ width: 78, height: 78, borderRadius: "50%", background: "var(--color-surface)", display: "grid", placeItems: "center", flexDirection: "column" }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: tone, lineHeight: 1 }}>{pct == null ? "—" : `${pct}%`}</span>
      </div>
    </div>
  );
}

function Bar({ pct }: { pct: number | null }) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div style={{ height: 8, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${p}%`, height: "100%", background: toneOf(pct), borderRadius: 99 }} />
    </div>
  );
}

export default async function KgiDashboardPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  if (!access) return <div className="page"><div className="card">ログインが必要です。</div></div>;

  const now = new Date();
  const y = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : now.getFullYear();
  const m = /^\d{1,2}$/.test(sp.m ?? "") && Number(sp.m) >= 1 && Number(sp.m) <= 12 ? Number(sp.m) : now.getMonth() + 1;
  const mk = `${y}-${two(m)}-01`;                 // 月初（YYYY-MM-01）
  const mEndExcl = m === 12 ? `${y + 1}-01-01` : `${y}-${two(m + 1)}-01`;
  const monthStart = new Date(`${mk}T00:00:00+09:00`);

  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;
  const isPastMonth = new Date(y, m - 1, 1) < new Date(now.getFullYear(), now.getMonth(), 1);
  const bizDaysMonth = businessDaysInMonth(mk);
  const todayStart = jstStartOfDay(now);
  const bizElapsed = isPastMonth ? bizDaysMonth : isCurrentMonth ? businessDaysInRange(monthStart, addDays(todayStart, 1)) : 0;
  const bizRemaining = Math.max(0, bizDaysMonth - bizElapsed);

  // ── KGI 目標（team_kgi 全社合算）＆ 実績（engagements 当月稼働）──
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }

  let targetSalesMan = 0, targetGrossMan = 0, kgiConfigured = false;
  let actualSalesMan = 0, actualGrossMan = 0, activeCount = 0, grossAllKnown = true;
  const canSeeGross = access.role === "admin"; // 全社集計の粗利は管理者のみ表示（給与漏洩防止）

  if (dbConfigured) {
    try {
      const tk: any = await sb.from("team_kgi")
        .select("active_current, active_add, rate_per_head_man, gross_per_head_man, department")
        .eq("month", mk);
      for (const row of (tk.data ?? [])) {
        const p = projectKgi(row);
        targetSalesMan += p.monthlyRevenueMan;
        targetGrossMan += p.monthlyGrossMan;
        kgiConfigured = true;
      }
    } catch { /* team_kgi 未整備でも続行 */ }

    try {
      const eng: any = await sb.from("engagements")
        .select("monthly_rate, cost, start_date, end_date, status")
        .limit(2000);
      for (const e of (eng.data ?? [])) {
        const sd: string | null = e.start_date ?? null;
        const ed: string | null = e.end_date ?? null;
        // 当月に稼働が重なるか（ISO日付は辞書順比較でOK）。終了が月初より前のものは除外。
        const overlaps = (!sd || sd < mEndExcl) && (!ed || ed >= mk);
        if (!overlaps) continue;
        if (String(e.status ?? "") === "終了" && ed && ed < mk) continue;
        const rate = Number(e.monthly_rate);
        if (!isNaN(rate) && e.monthly_rate != null) { actualSalesMan += rate; activeCount++; }
        const cost = Number(e.cost);
        if (e.cost == null || isNaN(cost)) grossAllKnown = false;
        else if (!isNaN(rate) && e.monthly_rate != null) actualGrossMan += (rate - cost);
      }
    } catch { /* engagements 未整備でも続行 */ }
  }

  // ── 営業日ベースの分解（月次 → 日次 → 週次）──
  const dailyKgi = bizDaysMonth > 0 ? targetSalesMan / bizDaysMonth : 0;
  const weeklyKgi = dailyKgi * 5;
  const salesPct = pctOf(actualSalesMan, targetSalesMan);
  const grossPct = pctOf(actualGrossMan, targetGrossMan);
  // ペース：本日時点で積み上がっているべき額（日次×経過営業日）と実績を比較。
  const expectedByToday = dailyKgi * bizElapsed;
  const onPace = actualSalesMan >= expectedByToday;
  const remainingNeed = Math.max(0, targetSalesMan - actualSalesMan);
  const recoveryDaily = bizRemaining > 0 ? remainingNeed / bizRemaining : remainingNeed;

  // ── KPI 先行指標（今月 実績/目標）＆ 1日あたり目標 ──
  let kpiRows: { key: Metric; label: string; actual: number; target: number; daily: number }[] = [];
  try {
    const baseDate = new Date(`${mk}T12:00:00+09:00`);
    const snap = await getKpiSnapshot({ ownerName: null, type: "month", base: baseDate });
    const weekly = await getWeeklyTargets({ ownerEmail: null, weekStart: jstStartOfWeek(now) });
    const dayRange = resolveRange("day");
    kpiRows = KGI_KPI_METRICS.map(({ key, label }) => ({
      key, label,
      actual: snap.snapshot[key]?.actual ?? 0,
      target: snap.snapshot[key]?.target ?? 0,
      daily: scaleWeeklyTarget(weekly[key] ?? 0, "day", dayRange),
    }));
  } catch { /* KPI 未整備でも続行 */ }

  const th: CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "9px 10px", fontSize: 13, borderTop: "1px solid var(--color-border)" };

  return (
    <div className="page">
      {/* ヘッダ（稼働管理と同じデザイン言語） */}
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div style={{ maxWidth: 820 }}>
          <div className="meta">KGI / KPI · ダッシュボード</div>
          <h1><span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28, verticalAlign: "-5px", marginRight: 8, color: "var(--color-brand-700)" }}>insights</span>KGI/KPI ダッシュボード</h1>
          <div className="sub">
            月次KGI（売上・粗利）を<b>営業日ベース</b>で週次・日次に分解し、日々の到達目標と進捗を可視化します。
            未達リスクを早期に把握し、残り営業日で必要な<b>リカバリー数値</b>を自動計算します。
            {!canSeeGross && "（粗利は権限を持つ人のみ表示されます）"}
          </div>
        </div>
      </div>

      {/* 年／月セレクタ */}
      <div className="card" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 800, fontSize: 14, marginRight: 6 }}>{y}年</span>
        {MONTHS.map((mm) => {
          const on = mm === m;
          return (
            <Link key={mm} href={`/kgi?y=${y}&m=${mm}`} prefetch={false} style={{
              padding: "6px 12px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: on ? 800 : 600,
              background: on ? "var(--color-brand-600)" : "transparent", color: on ? "#fff" : "var(--color-ink-2)",
            }}>{mm}月</Link>
          );
        })}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Link href={`/kgi?y=${m === 1 ? y - 1 : y}&m=${m === 1 ? 12 : m - 1}`} prefetch={false} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>← 前月</Link>
          <Link href={`/kgi?y=${m === 12 ? y + 1 : y}&m=${m === 12 ? 1 : m + 1}`} prefetch={false} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>翌月 →</Link>
        </span>
      </div>

      {!kgiConfigured && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5 }}>
          <b>{y}年{m}月のチーム月次KGIが未設定です。</b> 「KPI＆KGI」ページ（設定 → チームKGI）で、目標稼働数・1名あたり売上/粗利を登録すると、ここに目標が反映されます。
        </div>
      )}

      {/* サマリー（KGI進捗・本日の目標・ペース・リカバリー・粗利） */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div className="card" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 16 }}>
          <Gauge pct={salesPct} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>月次KGI（売上）進捗</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{man(actualSalesMan)}<span style={{ fontSize: 13, color: "var(--color-ink-4)", fontWeight: 700 }}> / {kgiConfigured ? man(targetSalesMan) : "—"}</span></div>
            <div className="muted" style={{ fontSize: 11 }}>当月稼働 {activeCount}名の月額合計</div>
          </div>
        </div>

        <StatCard label="本日のKGI目標（日割）" foot={`当月の営業日 ${bizDaysMonth}日 ／ 週次 ${kgiConfigured ? man(weeklyKgi) : "—"}`}>
          <span className="mono" style={{ fontSize: 26, fontWeight: 800 }}>{kgiConfigured ? man(dailyKgi) : "—"}</span>
        </StatCard>

        <StatCard
          label="ペース"
          foot={isCurrentMonth ? `本日までの必要累計 ${man(expectedByToday)}（経過 ${bizElapsed}営業日）` : isPastMonth ? "対象月は終了しています" : "対象月はまだ開始していません"}>
          {!kgiConfigured || !isCurrentMonth ? (
            <span style={{ fontSize: 18, fontWeight: 800, color: "var(--color-ink-4)" }}>—</span>
          ) : (
            <span style={{ fontSize: 18, fontWeight: 800, padding: "3px 12px", borderRadius: 99, background: onPace ? "#e7f7ee" : "#fef3f2", color: onPace ? "#067647" : "#b42318" }}>
              {onPace ? "順調" : "遅れあり"}
            </span>
          )}
        </StatCard>

        <StatCard label="リカバリー（残りで必要）" foot={`残り営業日 ${bizRemaining}日`}>
          <span className="mono" style={{ fontSize: 22, fontWeight: 800, color: remainingNeed > 0 ? "#b45309" : "#067647" }}>
            {kgiConfigured ? `${man(recoveryDaily)}/日` : "—"}
          </span>
          <div className="muted" style={{ fontSize: 11 }}>残り必要 {kgiConfigured ? man(remainingNeed) : "—"}</div>
        </StatCard>

        <StatCard label="月次KGI（粗利）" foot={canSeeGross ? (grossAllKnown ? "当月稼働の粗利合計" : "※ 一部の原価が未登録のため参考値") : undefined}>
          {canSeeGross ? (
            <>
              <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: toneOf(grossPct) }}>{man(actualGrossMan)}<span style={{ fontSize: 12, color: "var(--color-ink-4)", fontWeight: 700 }}> / {kgiConfigured ? man(targetGrossMan) : "—"}</span></span>
              <div style={{ marginTop: 6 }}><Bar pct={grossPct} /></div>
            </>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink-4)" }}>🔒 権限必要</span>
          )}
        </StatCard>
      </div>

      {/* KGI 分解（月次 → 週次 → 日次・営業日ベース） */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>flag</span>
          <b style={{ fontSize: 13.5 }}>KGI（売上）の営業日ベース分解</b>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>月次KGI ÷ 当月営業日 = 日次。単純な日割りではなく土日を除いた営業日で算出。</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>区分</th><th style={{ ...th, textAlign: "right" }}>目標</th><th style={{ ...th, textAlign: "right" }}>実績（当月）</th><th style={{ ...th, textAlign: "right" }}>達成率</th>
          </tr></thead>
          <tbody>
            <tr>
              <td style={td}><b>月次</b></td>
              <td style={{ ...td, textAlign: "right" }} className="mono">{kgiConfigured ? man(targetSalesMan) : "—"}</td>
              <td style={{ ...td, textAlign: "right" }} className="mono">{man(actualSalesMan)}</td>
              <td style={{ ...td, textAlign: "right", fontWeight: 800, color: toneOf(salesPct) }}>{salesPct == null ? "—" : `${salesPct}%`}</td>
            </tr>
            <tr>
              <td style={td}>週次（営業日5日）</td>
              <td style={{ ...td, textAlign: "right" }} className="mono">{kgiConfigured ? man(weeklyKgi) : "—"}</td>
              <td style={{ ...td, textAlign: "right", color: "var(--color-ink-4)" }}>—</td>
              <td style={{ ...td, textAlign: "right", color: "var(--color-ink-4)" }}>—</td>
            </tr>
            <tr>
              <td style={td}>日次（1営業日）</td>
              <td style={{ ...td, textAlign: "right" }} className="mono">{kgiConfigured ? man(dailyKgi) : "—"}</td>
              <td style={{ ...td, textAlign: "right", color: "var(--color-ink-4)" }}>—</td>
              <td style={{ ...td, textAlign: "right", color: "var(--color-ink-4)" }}>—</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* KPI 先行指標（提案 → 架電 → 面談 → 合格） */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>trending_up</span>
          <b style={{ fontSize: 13.5 }}>KPI（先行指標）今月の進捗</b>
          <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>KGI（売上）を作るための日々の行動。1日あたり目標は週次目標を営業日で割った値。</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>指標</th><th style={{ ...th, textAlign: "right" }}>今月 実績 / 目標</th><th style={{ ...th, textAlign: "right" }}>達成率</th><th style={{ ...th, textAlign: "right" }}>1日あたり目標</th>
          </tr></thead>
          <tbody>
            {kpiRows.length === 0 ? (
              <tr><td style={{ ...td, textAlign: "center", color: "var(--color-ink-4)" }} colSpan={4}>KPIデータがありません。</td></tr>
            ) : kpiRows.map((r) => {
              const p = pctOf(r.actual, r.target);
              return (
                <tr key={r.key}>
                  <td style={td}><b>{r.label}</b></td>
                  <td style={{ ...td, textAlign: "right" }} className="mono">{r.actual}<span style={{ color: "var(--color-ink-4)" }}> / {r.target || "—"}</span></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 800, color: toneOf(p) }}>{p == null ? "—" : `${p}%`}</td>
                  <td style={{ ...td, textAlign: "right" }} className="mono">{r.daily > 0 ? `${r.daily}件` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        ※ 初版は<b>全社ビュー</b>です。KGI目標は「チームKGI（部署×月）」の全社合算、KGI実績は当月に稼働している契約（engagements）の月額合計です。
        目標の登録は「設定 → チームKGI／メンバーKGI」から行えます。部署別・個人別の切替、日次カレンダー（予定と実績の並列表示）、SFA/CRM連携は今後の拡張予定です。
      </div>
    </div>
  );
}
