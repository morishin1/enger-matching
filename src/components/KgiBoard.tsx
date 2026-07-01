// KGI/KPI のデータ連動セクション（サーバーコンポーネント・自己データ取得）。
//   /kgi と トップダッシュボードの両方で共用する。各「実績」数値は根拠データ(/kgi/detail)へリンク。
//   sections で表示する区画を選択（既定は全部）。
//     season      … 年間シーズナリティ（月の動向・仮説）
//     monthly     … 売上目標から逆算したKPI（チーム目標）＝月次/週次/日次/実績/達成率
//     recovery    … 今日までの進捗とリカバリー（必要日次ペース）
//     weekly      … 週次カレンダー（実際のN週・提案管理連動）
//     procurement … 仕入れKGI（打ち合わせ→案件/人材情報の獲得）
import type { CSSProperties } from "react";
import Link from "@/components/AppLink";
import { businessDaysInMonth } from "@/lib/person-kgi";
import { getKgiSalesPlan, meetingCapacityMonth, recoveryPace, DEFAULT_MTG_PER_PERSON_DAY, type KgiMonthly } from "@/lib/kgi-plan";
import { weeksOfMonth, distributeMonthlyToWeeks, SEASON_PROFILES, SEASON_NOTES } from "@/lib/kgi-week";
import { getKpiSnapshot, getWeeklyKgiActuals, getMeetingKgi, businessDaysInRange, jstStartOfDay, addDays, type Metric, type MeetingAgg } from "@/lib/kpi";

export type KgiSection = "summary" | "season" | "monthly" | "recovery" | "weekly" | "procurement";
const ALL_SECTIONS: KgiSection[] = ["summary", "season", "monthly", "recovery", "weekly", "procurement"];

const two = (n: number) => String(n).padStart(2, "0");
const toneOf = (pct: number | null) =>
  pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 80 ? "#0095D9" : pct >= 50 ? "#b45309" : "#b42318";
const fmt = (n: number) => (n >= 10 ? Math.round(n).toLocaleString("ja-JP") : (Math.round(n * 10) / 10).toString());
const pctOf = (a: number, t: number): number | null => (t > 0 ? Math.round((a / t) * 100) : (a > 0 ? 100 : null));

// KPIキー → 根拠ドリルダウンの metric。
const EV_METRIC: Record<keyof KgiMonthly, string> = { placement: "deal", meeting: "schedule", proposal: "proposal", appointment: "meeting" };
const evHref = (metric: string, fromISO: string, toISO: string, ctx: string) =>
  `/kgi/detail?metric=${metric}&from=${fromISO}&to=${toISO}&ctx=${encodeURIComponent(ctx)}`;
const linkNum: CSSProperties = { textDecoration: "none", borderBottom: "1px dotted currentColor", cursor: "pointer" };

const KPI_DEFS: { key: keyof KgiMonthly; label: string; actual: Metric | null }[] = [
  { key: "placement", label: "稼働人数（合格）", actual: "deal" },
  { key: "meeting", label: "面談", actual: "schedule" },
  { key: "proposal", label: "提案", actual: "proposal" },
  { key: "appointment", label: "打ち合わせ", actual: null },
];
const WEEK_KPIS: { key: keyof KgiMonthly; label: string; act: "proposal" | "schedule" | "deal" }[] = [
  { key: "proposal", label: "提案", act: "proposal" },
  { key: "meeting", label: "面談", act: "schedule" },
  { key: "placement", label: "稼働", act: "deal" },
];

export async function KgiBoard({ month, sections = ALL_SECTIONS, showPlanHint = true }: { month: string; sections?: KgiSection[]; showPlanHint?: boolean }) {
  const show = (s: KgiSection) => sections.includes(s);
  const now = new Date();
  const [yy, mm] = month.split("-").map((x) => Number(x));
  const y = yy || now.getFullYear();
  const m = mm || now.getMonth() + 1;
  const mk = `${y}-${two(m)}-01`;
  const bizDays = businessDaysInMonth(mk);

  const planRow = await getKgiSalesPlan(mk);
  const salesTarget = planRow?.salesTargetMan ?? null;
  const headcount = planRow?.headcount ?? { inside: 0, outside: 0 };
  const plan = planRow?.plan ?? null;
  const capacity = meetingCapacityMonth(headcount, bizDays, DEFAULT_MTG_PER_PERSON_DAY);

  // 経過営業日（過去月=満了/未来月=0/当月=今日含む）。
  const monthStart = new Date(`${mk}T00:00:00+09:00`);
  const monthEndExcl = new Date(`${(m === 12 ? y + 1 : y)}-${two(m === 12 ? 1 : m + 1)}-01T00:00:00+09:00`);
  const todayEndExcl = addDays(jstStartOfDay(now), 1);
  const elapsedEnd = new Date(Math.min(monthEndExcl.getTime(), Math.max(monthStart.getTime(), todayEndExcl.getTime())));
  const bizElapsed = businessDaysInRange(monthStart, elapsedEnd);
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;

  const lastDom = new Date(y, m, 0).getDate();
  const monthToISO = `${y}-${two(m)}-${two(lastDom)}`;
  const monthCtx = `${y}年${m}月 累計`;

  // 実績（提案/面談/稼働）＝ proposals（当月累計）。
  const actualByMetric: Partial<Record<Metric, number>> = {};
  try {
    const snap = await getKpiSnapshot({ ownerName: null, type: "month", base: new Date(`${mk}T12:00:00+09:00`) });
    for (const k of ["proposal", "schedule", "deal"] as Metric[]) actualByMetric[k] = snap.snapshot[k]?.actual ?? 0;
  } catch { /* KPI未整備でも続行 */ }

  const jToday = new Date(now.getTime() + 9 * 3600 * 1000);
  const todayYmd = { y: jToday.getUTCFullYear(), m: jToday.getUTCMonth() + 1, d: jToday.getUTCDate() };
  const weeks = weeksOfMonth(mk, todayYmd);
  const season = SEASON_NOTES[m];

  const weekTargets = plan ? {
    proposal: distributeMonthlyToWeeks(plan.monthly.proposal, weeks, SEASON_PROFILES.proposal),
    meeting: distributeMonthlyToWeeks(plan.monthly.meeting, weeks, SEASON_PROFILES.meeting),
    placement: distributeMonthlyToWeeks(plan.monthly.placement, weeks, SEASON_PROFILES.placement),
    appointment: distributeMonthlyToWeeks(plan.monthly.appointment, weeks, SEASON_PROFILES.appointment),
  } : null;
  let weekActuals: { proposal: number; schedule: number; deal: number }[] = weeks.map(() => ({ proposal: 0, schedule: 0, deal: 0 }));
  if (plan && weeks.length) {
    try { weekActuals = await getWeeklyKgiActuals({ ownerName: null, weeks: weeks.map((w) => ({ fromISO: w.fromISO, toISO: w.toISO })) }); }
    catch { /* 続行 */ }
  }

  const emptyAgg = (): MeetingAgg => ({ meetings: 0, jobInfoMeetings: 0, candInfoMeetings: 0, jobInfoCount: 0, candInfoCount: 0 });
  let meetingKgi: { month: MeetingAgg; weeks: MeetingAgg[] } = { month: emptyAgg(), weeks: weeks.map(() => emptyAgg()) };
  if (weeks.length) {
    try { meetingKgi = await getMeetingKgi({ ownerName: null, monthFromISO: mk, monthToISO, weeks: weeks.map((w) => ({ fromISO: w.fromISO, toISO: w.toISO })) }); }
    catch { /* 続行 */ }
  }
  const apptActual = meetingKgi.month.meetings;
  const rateOf = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 100) : null);
  const actualOf = (key: keyof KgiMonthly, metric: Metric | null): number | null =>
    key === "appointment" ? apptActual : (metric ? (actualByMetric[metric] ?? 0) : null);

  // 全体ステータス（当月の進捗ペース）：各KPIの「今日までの想定 vs 実績」で判定。
  let statusBadge: { label: string; bg: string; fg: string; bd: string } | null = null;
  let kgiPct: number | null = null;
  if (plan) {
    let behind = 0;
    for (const d of KPI_DEFS) {
      const r = recoveryPace(plan.monthly[d.key] ?? 0, bizDays, bizElapsed, actualOf(d.key, d.actual) ?? 0);
      if (r.behind) behind++;
    }
    statusBadge = behind === 0 ? { label: "順調", bg: "#eefbf3", fg: "#067647", bd: "#bbe8cd" }
      : behind <= 1 ? { label: "やや遅れ", bg: "#fff7ed", fg: "#b45309", bd: "#fed7aa" }
        : { label: "遅れあり", bg: "#fef3f2", fg: "#b42318", bd: "#fecdca" };
    kgiPct = pctOf(actualByMetric.deal ?? 0, plan.monthly.placement ?? 0);
  }
  // 売上KGI（金額）の週次/日次（営業日ベース）。
  const weeklyMoney = salesTarget != null && bizDays > 0 ? (salesTarget * 5) / bizDays : null;
  const dailyMoney = salesTarget != null && bizDays > 0 ? salesTarget / bizDays : null;

  const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 13.5, borderTop: "1px solid var(--color-border)" };
  const tdR: CSSProperties = { ...td, textAlign: "right" };
  const weekly = (n: number) => bizDays > 0 ? (n * 5) / bizDays : 0;
  const daily = (n: number) => bizDays > 0 ? n / bizDays : 0;

  // 実績数値をリンク化する小ヘルパ（0や—はリンクにしない）。
  const actCell = (metricKey: string, value: number | null, fromISO: string, toISO: string, ctx: string, bold = false) => {
    if (value == null) return <span>—</span>;
    if (value <= 0) return <span>{value}件</span>;
    return <Link href={evHref(metricKey, fromISO, toISO, ctx)} prefetch={false} style={{ ...linkNum, fontWeight: bold ? 800 : undefined }} title="この件数の根拠データを表示">{value}件</Link>;
  };

  return (
    <>
      {/* KGIサマリー：月次進捗ゲージ ＋ 売上KGI(月/週/日) ＋ 本日の目標(日次KPI) ＋ 順調/遅れステータス */}
      {show("summary") && plan && (
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-brand-700)" }}>speed</span>
            <b style={{ fontSize: 14 }}>KGIサマリー（{y}年{m}月）</b>
            {statusBadge && <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 10px", borderRadius: 99, background: statusBadge.bg, color: statusBadge.fg, border: `1px solid ${statusBadge.bd}` }}>{statusBadge.label}</span>}
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>営業日 {bizElapsed}/{bizDays}日 経過・残り{Math.max(0, bizDays - bizElapsed)}日</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
            {/* 月次KGI進捗ゲージ（稼働＝売上の源泉） */}
            <div>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>月次KGI進捗（稼働＝売上の源泉）</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: toneOf(kgiPct) }}>{kgiPct == null ? "—" : `${kgiPct}%`}</div>
              <div style={{ height: 8, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", marginTop: 4 }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, kgiPct ?? 0))}%`, background: toneOf(kgiPct), borderRadius: 99 }} />
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>稼働 {actualByMetric.deal ?? 0} / {plan.monthly.placement}人</div>
            </div>
            {/* 売上KGI（金額）の月/週/日 */}
            <div>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>売上KGI（営業日ベース）</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.9, marginTop: 2 }}>
                月次 <b className="mono">{salesTarget != null ? salesTarget.toLocaleString("ja-JP") : "—"}万</b><br />
                週次 <b className="mono">{weeklyMoney != null ? fmt(weeklyMoney) : "—"}万</b> ／ 日次 <b className="mono">{dailyMoney != null ? fmt(dailyMoney) : "—"}万</b>
              </div>
              <div className="muted" style={{ fontSize: 10.5 }}>平均単価 <b>{Math.round(plan.avgDealMan)}万/名</b>（稼働＝売上÷平均単価）・週次＝月次×5÷営業日</div>
            </div>
            {/* 本日の目標（日次KPI）＋現在地 */}
            <div>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>本日の目標（日次KPI）</div>
              <div style={{ fontSize: 13, lineHeight: 1.9, marginTop: 2 }}>
                提案 <b>{fmt(daily(plan.monthly.proposal))}</b> ・ 面談 <b>{fmt(daily(plan.monthly.meeting))}</b> ・ 稼働 <b>{fmt(daily(plan.monthly.placement))}</b> ・ 打合せ <b>{fmt(daily(plan.monthly.appointment))}</b>
              </div>
              <div className="muted" style={{ fontSize: 10.5 }}>当月実績 提案{actualByMetric.proposal ?? 0}・面談{actualByMetric.schedule ?? 0}・稼働{actualByMetric.deal ?? 0}・打合せ{apptActual}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
            ※ ステータスは各KPIの「今日までの想定（月次×経過営業日÷総営業日）」と実績の比較で判定（<b>順調＝全KPIが想定以上</b>／遅れ＝下回るKPIあり）。詳細と根拠は下表・数値クリックから。
          </div>
        </div>
      )}

      {/* 年間シーズナリティ */}
      {show("season") && season && (
        <div className="card" style={{ padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: season.push ? "#b45309" : "var(--color-brand-700)" }}>event_upcoming</span>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800 }}>
              {season.quarter}｜{m}月の動向：{season.headline}
              {season.push && <span style={{ marginLeft: 8, fontSize: 10.5, color: "#b45309", fontWeight: 800, border: "1px solid #fed7aa", background: "#fff7ed", borderRadius: 6, padding: "1px 6px" }}>提案強化月</span>}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.7 }}>{season.note}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.7 }}>
              月内リズム（仮説）：<b>上旬(1–10)</b>=内務・フォロー ／ <b style={{ color: "#b45309" }}>中旬(11–20)</b>=★提案最大化（週次目標を約1.5倍に配分） ／ <b>下旬(21–末)</b>=クロージング（稼働は下旬に厚め）。
            </div>
          </div>
        </div>
      )}

      {/* プラン未設定の案内（monthly/weekly を出したいのに plan が無い場合） */}
      {showPlanHint && !plan && (show("monthly") || show("weekly")) && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5, lineHeight: 1.7 }}>
          月間売上目標が未設定です。<Link href="/kgi" prefetch={false} style={{ color: "#9a7b12", fontWeight: 800 }}>KGI/KPI</Link> で売上目標と人員を設定し「AIで計算」すると、逆算KPIと達成率がここに表示されます。
        </div>
      )}

      {/* 売上目標から逆算したKPI（チーム目標） */}
      {show("monthly") && plan && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>flag</span>
            <b style={{ fontSize: 13.5 }}>売上目標から逆算したKPI（チーム目標）</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>週次＝月次×5÷営業日、日次＝月次÷営業日（数値クリックで根拠データ）</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>
                <th style={th}>KPI</th>
                <th style={{ ...th, textAlign: "right" }}>月次目標</th>
                <th style={{ ...th, textAlign: "right" }}>週次目標</th>
                <th style={{ ...th, textAlign: "right" }}>日次目標</th>
                <th style={{ ...th, textAlign: "right" }}>今月実績</th>
                <th style={{ ...th, textAlign: "right" }}>達成率</th>
              </tr></thead>
              <tbody>
                {KPI_DEFS.map(({ key, label, actual }) => {
                  const monthlyN = plan.monthly[key] ?? 0;
                  const act = actualOf(key, actual);
                  const p = act != null ? pctOf(act, monthlyN) : null;
                  const over = key === "appointment" && capacity > 0 && monthlyN > capacity;
                  return (
                    <tr key={key}>
                      <td style={td}><b>{label}</b>{over && <span style={{ marginLeft: 6, fontSize: 10.5, color: "#b42318", fontWeight: 800 }}>容量超過</span>}</td>
                      <td style={tdR} className="mono">{fmt(monthlyN)}件</td>
                      <td style={tdR} className="mono">{fmt(weekly(monthlyN))}件</td>
                      <td style={tdR} className="mono">{fmt(daily(monthlyN))}件</td>
                      <td style={tdR} className="mono">{actCell(EV_METRIC[key], act, mk, monthToISO, monthCtx)}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: toneOf(p) }}>{p == null ? "—" : `${p}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px", lineHeight: 1.7 }}>
            ※ 稼働人数＝合格、面談・提案は proposals（提案管理）由来。<b>打ち合わせは打ち合わせ記録（meetings）と連動</b>。実績数値はクリックで根拠データを表示します。
          </div>
        </div>
      )}

      {/* 今日までの進捗とリカバリー */}
      {show("recovery") && plan && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>trending_up</span>
            <b style={{ fontSize: 13.5 }}>今日までの進捗とリカバリー</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>
              営業日 {bizElapsed}/{bizDays}日 経過 ・ 残り {Math.max(0, bizDays - bizElapsed)}日{isCurrentMonth ? "（当月）" : (bizElapsed >= bizDays ? "（終了月）" : "（未来月）")}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead><tr>
                <th style={th}>KPI</th>
                <th style={{ ...th, textAlign: "right" }}>月次目標</th>
                <th style={{ ...th, textAlign: "right" }}>今日までの想定</th>
                <th style={{ ...th, textAlign: "right" }}>実績</th>
                <th style={{ ...th, textAlign: "right" }}>差分</th>
                <th style={{ ...th, textAlign: "right" }}>当初の日次</th>
                <th style={{ ...th, textAlign: "right" }}>これから必要な日次</th>
              </tr></thead>
              <tbody>
                {KPI_DEFS.filter((d) => actualOf(d.key, d.actual) != null).map(({ key, label, actual }) => {
                  const monthlyN = plan.monthly[key] ?? 0;
                  const act = actualOf(key, actual) ?? 0;
                  const r = recoveryPace(monthlyN, bizDays, bizElapsed, act);
                  return (
                    <tr key={key}>
                      <td style={td}><b>{label}</b></td>
                      <td style={tdR} className="mono">{fmt(monthlyN)}件</td>
                      <td style={tdR} className="mono">{fmt(r.expectedToDate)}件</td>
                      <td style={tdR} className="mono">{actCell(EV_METRIC[key], act, mk, monthToISO, monthCtx)}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: r.gap >= 0 ? "#067647" : "#b42318" }} className="mono">{r.gap >= 0 ? "+" : "−"}{fmt(Math.abs(r.gap))}</td>
                      <td style={tdR} className="mono">{fmt(r.normalDaily)}件</td>
                      <td style={{ ...tdR, fontWeight: 800, color: r.catchUp ? "#b42318" : "#067647" }} className="mono">
                        {r.remainingDays > 0 ? `${fmt(r.requiredDaily)}件` : (monthlyN - act > 0 ? "未達" : "達成")}
                        {r.catchUp && r.remainingDays > 0 && <span style={{ marginLeft: 4, fontSize: 10 }}>↑要加速</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px", lineHeight: 1.7 }}>
            ※ 「今日までの想定」＝月次目標×経過営業日÷総営業日。「差分」＝実績−想定（＋貯金／−遅れ）。「これから必要な日次」＝残÷残営業日（<b>当初日次を上回る＝要加速</b>）。
          </div>
        </div>
      )}

      {/* 週次カレンダー（実際のN週・提案管理連動） */}
      {show("weekly") && plan && weekTargets && weeks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>calendar_month</span>
            <b style={{ fontSize: 13.5 }}>週次カレンダー（{weeks.length}週）— 実績は提案管理と連動</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>各週＝営業日数×旬ウェイトで配分（合計＝月次目標）／ セル：<b>実績/目標</b>（実績クリックで根拠）</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>週</th>
                <th style={{ ...th, textAlign: "right" }}>営業日</th>
                {WEEK_KPIS.map((k) => <th key={k.key} style={{ ...th, textAlign: "right" }}>{k.label}</th>)}
                <th style={{ ...th, textAlign: "right" }}>打合せ</th>
              </tr></thead>
              <tbody>
                {weeks.map((w, wi) => {
                  const wctx = `W${w.index} ${w.label}`;
                  return (
                    <tr key={w.index} style={{ background: w.isCurrent ? "rgba(0,149,217,0.06)" : undefined }}>
                      <td style={td}>
                        <b>W{w.index}</b> <span className="muted" style={{ fontSize: 11 }}>{w.label}</span>
                        {w.isCurrent && <span style={{ marginLeft: 6, fontSize: 10, color: "#0095D9", fontWeight: 800 }}>今週・残{w.remainingBiz}日</span>}
                        {w.isPast && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-ink-4)" }}>済</span>}
                      </td>
                      <td style={tdR} className="mono">{w.bizDays}日</td>
                      {WEEK_KPIS.map((k) => {
                        const tgt = weekTargets[k.key][wi] ?? 0;
                        const act = weekActuals[wi]?.[k.act] ?? 0;
                        const p = pctOf(act, tgt);
                        const dly = w.bizDays > 0 ? tgt / w.bizDays : 0;
                        return (
                          <td key={k.key} style={tdR}>
                            <div className="mono" style={{ fontWeight: 700 }}><b style={{ color: toneOf(p) }}>{actCell(EV_METRIC[k.key], act, w.fromISO, w.toISO, wctx, true)}</b> / {tgt}</div>
                            <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{p == null ? "—" : `${p}%`}・日{fmt(dly)}</div>
                          </td>
                        );
                      })}
                      {(() => {
                        const tgt = weekTargets.appointment[wi] ?? 0;
                        const act = meetingKgi.weeks[wi]?.meetings ?? 0;
                        const p = pctOf(act, tgt);
                        const dly = w.bizDays > 0 ? tgt / w.bizDays : 0;
                        return (
                          <td style={tdR}>
                            <div className="mono" style={{ fontWeight: 700 }}><b style={{ color: toneOf(p) }}>{actCell("meeting", act, w.fromISO, w.toISO, wctx, true)}</b> / {tgt}</div>
                            <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{p == null ? "—" : `${p}%`}・日{fmt(dly)}</div>
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
                <tr style={{ background: "var(--color-surface-2, rgba(0,0,0,0.02))", borderTop: "2px solid var(--color-border)" }}>
                  <td style={{ ...td, fontWeight: 800 }}>月合計</td>
                  <td style={tdR} className="mono">{bizDays}日</td>
                  {WEEK_KPIS.map((k) => {
                    const tgt = plan.monthly[k.key] ?? 0;
                    const act = actualByMetric[k.act as Metric] ?? weekActuals.reduce((s, x) => s + x[k.act], 0);
                    const p = pctOf(act, tgt);
                    return (
                      <td key={k.key} style={tdR}>
                        <div className="mono" style={{ fontWeight: 800 }}><b style={{ color: toneOf(p) }}>{actCell(EV_METRIC[k.key], act, mk, monthToISO, monthCtx, true)}</b> / {tgt}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{p == null ? "—" : `${p}%`}</div>
                      </td>
                    );
                  })}
                  {(() => {
                    const tgt = plan.monthly.appointment; const act = apptActual; const p = pctOf(act, tgt);
                    return (
                      <td style={tdR}>
                        <div className="mono" style={{ fontWeight: 800 }}><b style={{ color: toneOf(p) }}>{actCell("meeting", act, mk, monthToISO, monthCtx, true)}</b> / {tgt}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{p == null ? "—" : `${p}%`}</div>
                      </td>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px", lineHeight: 1.7 }}>
            ※ 週の合計は月次目標に一致（<b>全週達成で月間目標に到達</b>）。実績は proposals（提案管理）・打ち合わせは meetings と連動。実績数値クリックで根拠データを表示。
          </div>
        </div>
      )}

      {/* 仕入れKGI（打ち合わせ→案件/人材情報の獲得） */}
      {show("procurement") && weeks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>inventory_2</span>
            <b style={{ fontSize: 13.5 }}>仕入れKGI｜打ち合わせ → 提案（レジュメ提出）への転換</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>打合せは提案を稼ぐ手段。数値クリックで根拠データ</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 0, borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ padding: "14px 18px", borderRight: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>打合せ数（活動KPI・毎日3件）</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{actCell("meeting", meetingKgi.month.meetings, mk, monthToISO, monthCtx, true)}</div>
              {plan && <div className="muted" style={{ fontSize: 11 }}>目標 {plan.monthly.appointment}件 ／ 達成 {pctOf(apptActual, plan.monthly.appointment) ?? 0}%</div>}
            </div>
            <div style={{ padding: "14px 18px", borderRight: "1px solid var(--color-border)", background: "rgba(0,149,217,0.05)" }}>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>★ 打合せ→提案 転換（キモ）</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: toneOf(rateOf(actualByMetric.proposal ?? 0, meetingKgi.month.meetings)) }}>
                {rateOf(actualByMetric.proposal ?? 0, meetingKgi.month.meetings) ?? 0}%
              </div>
              <div className="muted" style={{ fontSize: 11 }}>提案 {actCell("proposal", actualByMetric.proposal ?? 0, mk, monthToISO, monthCtx)} ÷ 打合せ {meetingKgi.month.meetings}件</div>
            </div>
            <div style={{ padding: "14px 18px", borderRight: "1px solid var(--color-border)" }}>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>①案件情報の獲得（提案の余白）</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "#0e7490" }}>{actCell("jobinfo", meetingKgi.month.jobInfoCount, mk, monthToISO, monthCtx, true)}</div>
              <div className="muted" style={{ fontSize: 11 }}>獲得率 <b style={{ color: toneOf(rateOf(meetingKgi.month.jobInfoMeetings, meetingKgi.month.meetings)) }}>{rateOf(meetingKgi.month.jobInfoMeetings, meetingKgi.month.meetings) ?? 0}%</b></div>
            </div>
            <div style={{ padding: "14px 18px" }}>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>②人材情報の獲得（空き要員）</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "#7c3aed" }}>{actCell("candinfo", meetingKgi.month.candInfoCount, mk, monthToISO, monthCtx, true)}</div>
              <div className="muted" style={{ fontSize: 11 }}>獲得率 <b style={{ color: toneOf(rateOf(meetingKgi.month.candInfoMeetings, meetingKgi.month.meetings)) }}>{rateOf(meetingKgi.month.candInfoMeetings, meetingKgi.month.meetings) ?? 0}%</b></div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead><tr>
                <th style={th}>週</th>
                <th style={{ ...th, textAlign: "right" }}>打合せ</th>
                <th style={{ ...th, textAlign: "right" }}>案件情報（件／獲得率）</th>
                <th style={{ ...th, textAlign: "right" }}>人材情報（件／獲得率）</th>
              </tr></thead>
              <tbody>
                {weeks.map((w, wi) => {
                  const a = meetingKgi.weeks[wi] ?? emptyAgg();
                  const jr = rateOf(a.jobInfoMeetings, a.meetings);
                  const cr = rateOf(a.candInfoMeetings, a.meetings);
                  const wctx = `W${w.index} ${w.label}`;
                  return (
                    <tr key={w.index} style={{ background: w.isCurrent ? "rgba(0,149,217,0.06)" : undefined }}>
                      <td style={td}><b>W{w.index}</b> <span className="muted" style={{ fontSize: 11 }}>{w.label}</span>{w.isCurrent && <span style={{ marginLeft: 6, fontSize: 10, color: "#0095D9", fontWeight: 800 }}>今週</span>}</td>
                      <td style={tdR} className="mono">{actCell("meeting", a.meetings, w.fromISO, w.toISO, wctx)}</td>
                      <td style={tdR} className="mono">{actCell("jobinfo", a.jobInfoCount, w.fromISO, w.toISO, wctx)} <span style={{ color: toneOf(jr) }}>{jr == null ? "—" : `${jr}%`}</span></td>
                      <td style={tdR} className="mono">{actCell("candinfo", a.candInfoCount, w.fromISO, w.toISO, wctx)} <span style={{ color: toneOf(cr) }}>{cr == null ? "—" : `${cr}%`}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px", lineHeight: 1.8 }}>
            ※ 因果：<b>売上・粗利</b> ← 稼働・面談 ← <b style={{ color: "#0095D9" }}>提案（レジュメ提出）★キモ</b> ← 打合せ（毎日3件）。打合せは提案を稼ぐ<b>手段</b>で、KGIは「その打合せから何件の提案を生めたか（＝打合せ→提案 転換）」。
            打合せで持ち帰るべき3成果物＝<b>①案件の“提案の余白”</b>（要件緩和/時期調整/競合・予算）／<b>②人材の“空き要員と強み”</b>（直近満了/レジュメにない強み/単価柔軟性）／<b>③ネクストアクションの確約</b>。①②の件数は打ち合わせ記録（<code>/meetings</code>）の入力から集計。数値クリックで根拠データ。
          </div>
        </div>
      )}
    </>
  );
}
