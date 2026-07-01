// KGI/KPI ダッシュボード。
//   月間売上目標（手動）＋ 人員配分（インサイド/アウトサイド）→ AIが逆算して
//   稼働人数/面談/提案/打ち合わせ の月次KPIに割り振り、営業日数で週次・日次に按分して
//   「チームで達成する」目標として表示する。打ち合わせは人員容量（1人1日3件）で実現性を判定。
//   実績（提案/面談/稼働）は proposals 由来（getKpiSnapshot）で達成率＋リカバリー必要ペースを併記。
import type { CSSProperties } from "react";
import Link from "@/components/AppLink";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { businessDaysInMonth } from "@/lib/person-kgi";
import {
  getKgiSalesPlan, meetingCapacityMonth, recoveryPace,
  DEFAULT_MTG_PER_PERSON_DAY, type KgiMonthly,
} from "@/lib/kgi-plan";
import {
  weeksOfMonth, distributeMonthlyToWeeks, SEASON_PROFILES, SEASON_NOTES,
} from "@/lib/kgi-week";
import { KgiPlanControls } from "@/components/KgiPlanControls";
import { getKpiSnapshot, getWeeklyKgiActuals, businessDaysInRange, jstStartOfDay, addDays, type Metric } from "@/lib/kpi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const two = (n: number) => String(n).padStart(2, "0");
const toneOf = (pct: number | null) =>
  pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 80 ? "#0095D9" : pct >= 50 ? "#b45309" : "#b42318";
const fmt = (n: number) => (n >= 10 ? Math.round(n).toLocaleString("ja-JP") : (Math.round(n * 10) / 10).toString());
const pctOf = (a: number, t: number): number | null => (t > 0 ? Math.round((a / t) * 100) : (a > 0 ? 100 : null));

// 割り振り対象KPI（表示順）。actualKey は proposals 由来の実績メトリクス（打ち合わせは実績なし）。
const KPI_DEFS: { key: keyof KgiMonthly; label: string; actual: Metric | null }[] = [
  { key: "placement", label: "稼働人数（合格）", actual: "deal" },
  { key: "meeting", label: "面談", actual: "schedule" },
  { key: "proposal", label: "提案", actual: "proposal" },
  { key: "appointment", label: "打ち合わせ", actual: null },
];

export default async function KgiDashboardPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  if (!access) return <div className="page"><div className="card">ログインが必要です。</div></div>;
  const canEdit = access.role === "admin" || canManageDept(access.teamRole);

  const now = new Date();
  const y = /^\d{4}$/.test(sp.y ?? "") ? Number(sp.y) : now.getFullYear();
  const m = /^\d{1,2}$/.test(sp.m ?? "") && Number(sp.m) >= 1 && Number(sp.m) <= 12 ? Number(sp.m) : now.getMonth() + 1;
  const mk = `${y}-${two(m)}-01`;
  const bizDays = businessDaysInMonth(mk);

  const planRow = await getKgiSalesPlan(mk);
  const salesTarget = planRow?.salesTargetMan ?? null;
  const headcount = planRow?.headcount ?? { inside: 0, outside: 0 };
  const plan = planRow?.plan ?? null;

  // 打ち合わせ容量（現在の人員配分ベース）と、当月の打ち合わせ目標の実現性。
  const capacity = meetingCapacityMonth(headcount, bizDays, DEFAULT_MTG_PER_PERSON_DAY);
  const apptTarget = plan?.monthly.appointment ?? 0;
  const feasible = capacity <= 0 ? null : apptTarget <= capacity; // 人員未入力なら判定なし

  // 「今日まで」に経過した営業日数（過去月＝満了、未来月＝0、当月＝今日を含む）。
  const monthStart = new Date(`${mk}T00:00:00+09:00`);
  const monthEndExcl = new Date(`${(m === 12 ? y + 1 : y)}-${two(m === 12 ? 1 : m + 1)}-01T00:00:00+09:00`);
  const todayEndExcl = addDays(jstStartOfDay(now), 1);
  const elapsedEnd = new Date(Math.min(monthEndExcl.getTime(), Math.max(monthStart.getTime(), todayEndExcl.getTime())));
  const bizElapsed = businessDaysInRange(monthStart, elapsedEnd);
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;

  // チーム実績（今月・全社）：提案/面談/稼働 の件数（月内累計＝今日までの実績）。
  const actualByMetric: Partial<Record<Metric, number>> = {};
  try {
    const snap = await getKpiSnapshot({ ownerName: null, type: "month", base: new Date(`${mk}T12:00:00+09:00`) });
    for (const k of ["proposal", "schedule", "deal"] as Metric[]) actualByMetric[k] = snap.snapshot[k]?.actual ?? 0;
  } catch { /* KPI未整備でも続行 */ }

  // 実際の週（Mon-Fri・月内クリップ）。7月なら5週、第1週は Jul1-3 の3営業日、等。
  const jToday = new Date(now.getTime() + 9 * 3600 * 1000); // JSTの壁時計に補正して日付を取る
  const todayYmd = { y: jToday.getUTCFullYear(), m: jToday.getUTCMonth() + 1, d: jToday.getUTCDate() };
  const weeks = weeksOfMonth(mk, todayYmd);
  const season = SEASON_NOTES[m];

  // 月次KPIを《旬ウェイト×営業日》で各週へ配分（Σ=月次）。実績は提案管理(proposals)から週別に集計。
  const weekTargets = plan ? {
    proposal: distributeMonthlyToWeeks(plan.monthly.proposal, weeks, SEASON_PROFILES.proposal),
    meeting: distributeMonthlyToWeeks(plan.monthly.meeting, weeks, SEASON_PROFILES.meeting),
    placement: distributeMonthlyToWeeks(plan.monthly.placement, weeks, SEASON_PROFILES.placement),
    appointment: distributeMonthlyToWeeks(plan.monthly.appointment, weeks, SEASON_PROFILES.appointment),
  } : null;
  let weekActuals: { proposal: number; schedule: number; deal: number }[] = weeks.map(() => ({ proposal: 0, schedule: 0, deal: 0 }));
  if (plan && weeks.length) {
    try { weekActuals = await getWeeklyKgiActuals({ ownerName: null, weeks: weeks.map((w) => ({ fromISO: w.fromISO, toISO: w.toISO })) }); }
    catch { /* 提案管理未整備でも続行 */ }
  }
  // 週次表示の対象KPI（実績が取れる 提案/面談/稼働）と、目標のみの打ち合わせ。
  const WEEK_KPIS: { key: keyof KgiMonthly; label: string; act: "proposal" | "schedule" | "deal" }[] = [
    { key: "proposal", label: "提案", act: "proposal" },
    { key: "meeting", label: "面談", act: "schedule" },
    { key: "placement", label: "稼働", act: "deal" },
  ];

  const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 13.5, borderTop: "1px solid var(--color-border)" };
  const tdR: CSSProperties = { ...td, textAlign: "right" };

  const weekly = (monthlyN: number) => bizDays > 0 ? (monthlyN * 5) / bizDays : 0; // 1週=営業日5日
  const daily = (monthlyN: number) => bizDays > 0 ? monthlyN / bizDays : 0;

  return (
    <div className="page">
      {/* ヘッダ */}
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div style={{ maxWidth: 860 }}>
          <div className="meta">KGI / KPI · ダッシュボード</div>
          <h1><span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28, verticalAlign: "-5px", marginRight: 8, color: "var(--color-brand-700)" }}>insights</span>KGI/KPI ダッシュボード</h1>
          <div className="sub">
            <b>月間の売上目標</b>と<b>人員配分（インサイド/アウトサイド）</b>を設定すると、達成に必要な
            <b>提案数・面談数・稼働人数・打ち合わせ数</b>をAIが逆算し、営業日数で<b>週次・日次</b>に割り振ります。
            打ち合わせは<b>1人1日{DEFAULT_MTG_PER_PERSON_DAY}件</b>を上限に実現性を判定し、遅れは<b>必要日次ペース</b>で取り戻します。
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

      {/* 売上目標・人員配分（手動）＋ AI計算 */}
      <KgiPlanControls month={mk} initialTarget={salesTarget} initialInside={headcount.inside} initialOutside={headcount.outside} hasPlan={!!plan} canEdit={canEdit} />

      {/* サマリー：売上目標・人員/容量・AI前提 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>月間売上目標</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{salesTarget != null ? `${salesTarget.toLocaleString("ja-JP")}万` : "未設定"}</div>
          <div className="muted" style={{ fontSize: 11 }}>当月の営業日 {bizDays}日（土日除く）</div>
        </div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>人員配分・打ち合わせ容量</div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 2 }}>
            IN {headcount.inside}名 ／ OUT {headcount.outside}名
            <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>（計{headcount.inside + headcount.outside}名）</span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.6 }}>
            {capacity > 0
              ? <>月間打ち合わせ容量 <b>約{capacity.toLocaleString("ja-JP")}件</b>（{headcount.inside + headcount.outside}名×{DEFAULT_MTG_PER_PERSON_DAY}件/日×{bizDays}日）</>
              : <>人員を入力すると容量を試算します</>}
          </div>
        </div>
        {plan && (
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>AIの前提（逆算の根拠）</div>
            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.7 }}>
              平均単価 <b>{Math.round(plan.avgDealMan)}万</b>/名・月 ／ 転換率 打合せ→提案 <b>{Math.round(plan.conv.appointmentToProposal * 100)}%</b>・提案→面談 <b>{Math.round(plan.conv.proposalToMeeting * 100)}%</b>・面談→稼働 <b>{Math.round(plan.conv.meetingToPlacement * 100)}%</b>
            </div>
            {plan.rationale && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{plan.rationale}</div>}
          </div>
        )}
      </div>

      {/* 実現性の判定＆打ち手（AIの実現条件） */}
      {plan && feasible === false && (
        <div className="card" style={{ background: "#fef3f2", borderColor: "#fecdca", color: "#b42318", fontSize: 12.5, lineHeight: 1.7 }}>
          <b>⚠ 打ち合わせ目標が人員容量を超えています。</b>
          目標 <b>{apptTarget.toLocaleString("ja-JP")}件</b> ＞ 容量 <b>約{capacity.toLocaleString("ja-JP")}件</b>（1人1日{DEFAULT_MTG_PER_PERSON_DAY}件換算）。
          数を追うより<b>単価↑・転換率↑・増員</b>、または<b>エンド直案件の獲得</b>・<b>フリーランス/BP人材の確保</b>で必要数を圧縮してください。
          {plan.advice && <div style={{ marginTop: 6, color: "#7a271a" }}>AIの提案：{plan.advice}</div>}
        </div>
      )}
      {plan && feasible === true && plan.advice && (
        <div className="card" style={{ background: "#eefbf3", borderColor: "#bbe8cd", color: "#067647", fontSize: 12.5, lineHeight: 1.7 }}>
          <b>✓ 打ち合わせ目標は現在の人員容量に収まります。</b>
          <div style={{ marginTop: 4, color: "#05603a" }}>AIの提案：{plan.advice}</div>
        </div>
      )}

      {!plan && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5 }}>
          {salesTarget == null
            ? <><b>まず月間売上目標と人員配分を入力してください。</b> その後「AIで週次/日次KPIを計算」を押すと、必要な提案数・面談数・稼働人数・打ち合わせ数が割り振られます。</>
            : <><b>「AIで週次/日次KPIを計算」を押してください。</b> 売上目標 {salesTarget?.toLocaleString("ja-JP")}万円 と人員配分から逆算します。</>}
        </div>
      )}

      {/* AI割り振り結果（月次 → 週次 → 日次） */}
      {plan && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>flag</span>
            <b style={{ fontSize: 13.5 }}>売上目標から逆算したKPI（チーム目標）</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>週次＝月次×5÷営業日、日次＝月次÷営業日（土日を除く営業日ベース）</span>
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
                  const act = actual ? (actualByMetric[actual] ?? 0) : null;
                  const p = act != null ? pctOf(act, monthlyN) : null;
                  const over = key === "appointment" && capacity > 0 && monthlyN > capacity;
                  return (
                    <tr key={key}>
                      <td style={td}><b>{label}</b>{over && <span style={{ marginLeft: 6, fontSize: 10.5, color: "#b42318", fontWeight: 800 }}>容量超過</span>}</td>
                      <td style={tdR} className="mono">{fmt(monthlyN)}件</td>
                      <td style={tdR} className="mono">{fmt(weekly(monthlyN))}件</td>
                      <td style={tdR} className="mono">{fmt(daily(monthlyN))}件</td>
                      <td style={tdR} className="mono">{act == null ? "—" : `${act}件`}</td>
                      <td style={{ ...tdR, fontWeight: 800, color: toneOf(p) }}>{p == null ? "—" : `${p}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px", lineHeight: 1.7 }}>
            ※ 稼働人数＝合格（稼働決定）、面談・提案は proposals 由来の実績。打ち合わせは実績集計対象外のため目標のみ。
            実績はチーム全体（全社）の今月分です。{planRow?.updatedByName && `／ 更新: ${planRow.updatedByName}`}
          </div>
        </div>
      )}

      {/* 今日までの進捗とリカバリー（毎日→週→月のゴールに接続） */}
      {plan && (
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
                {KPI_DEFS.filter((d) => d.actual != null).map(({ key, label, actual }) => {
                  const monthlyN = plan.monthly[key] ?? 0;
                  const act = actualByMetric[actual as Metric] ?? 0;
                  const r = recoveryPace(monthlyN, bizDays, bizElapsed, act);
                  return (
                    <tr key={key}>
                      <td style={td}><b>{label}</b></td>
                      <td style={tdR} className="mono">{fmt(monthlyN)}件</td>
                      <td style={tdR} className="mono">{fmt(r.expectedToDate)}件</td>
                      <td style={tdR} className="mono">{act}件</td>
                      <td style={{ ...tdR, fontWeight: 800, color: r.gap >= 0 ? "#067647" : "#b42318" }} className="mono">
                        {r.gap >= 0 ? "+" : "−"}{fmt(Math.abs(r.gap))}
                      </td>
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
            ※ 「今日までの想定」＝月次目標×経過営業日÷総営業日（線形按分）。「差分」＝実績−想定（＋は貯金／−は遅れ）。
            「これから必要な日次」＝残（月次−実績）÷残営業日。<b>当初の日次を上回る＝遅れており加速（リカバリー）が必要</b>です。打ち合わせは実績集計対象外のため除外しています。
          </div>
        </div>
      )}

      {/* 年間シーズナリティ（月の動向・仮説） */}
      {season && (
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

      {/* 週次カレンダー（実際のN週・提案管理連動）：月/週/日の達成率 */}
      {plan && weekTargets && weeks.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>calendar_month</span>
            <b style={{ fontSize: 13.5 }}>週次カレンダー（{weeks.length}週）— 実績は提案管理と連動</b>
            <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>各週＝営業日数×旬ウェイトで配分（合計＝月次目標）／ セル：<b>実績/目標</b>・下段=達成率・日次</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={th}>週</th>
                <th style={{ ...th, textAlign: "right" }}>営業日</th>
                {WEEK_KPIS.map((k) => <th key={k.key} style={{ ...th, textAlign: "right" }}>{k.label}</th>)}
                <th style={{ ...th, textAlign: "right" }}>打合せ(目標)</th>
              </tr></thead>
              <tbody>
                {weeks.map((w, wi) => {
                  const rowBg = w.isCurrent ? "rgba(0,149,217,0.06)" : undefined;
                  return (
                    <tr key={w.index} style={{ background: rowBg }}>
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
                            <div className="mono" style={{ fontWeight: 700 }}><b style={{ color: toneOf(p) }}>{act}</b> / {tgt}</div>
                            <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{p == null ? "—" : `${p}%`}・日{fmt(dly)}</div>
                          </td>
                        );
                      })}
                      <td style={tdR}>
                        <div className="mono" style={{ fontWeight: 700 }}>{weekTargets.appointment[wi] ?? 0}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>日{fmt(w.bizDays > 0 ? (weekTargets.appointment[wi] ?? 0) / w.bizDays : 0)}</div>
                      </td>
                    </tr>
                  );
                })}
                {/* 合計（＝月次目標 と 月次実績）で全週達成＝月間目標を確認 */}
                <tr style={{ background: "var(--color-surface-2, rgba(0,0,0,0.02))", borderTop: "2px solid var(--color-border)" }}>
                  <td style={{ ...td, fontWeight: 800 }}>月合計</td>
                  <td style={tdR} className="mono">{bizDays}日</td>
                  {WEEK_KPIS.map((k) => {
                    const tgt = plan.monthly[k.key] ?? 0;
                    const act = actualByMetric[k.act as Metric] ?? weekActuals.reduce((s, x) => s + x[k.act], 0);
                    const p = pctOf(act, tgt);
                    return (
                      <td key={k.key} style={tdR}>
                        <div className="mono" style={{ fontWeight: 800 }}><b style={{ color: toneOf(p) }}>{act}</b> / {tgt}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{p == null ? "—" : `${p}%`}</div>
                      </td>
                    );
                  })}
                  <td style={{ ...tdR, fontWeight: 800 }} className="mono">{plan.monthly.appointment}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 11, padding: "10px 16px", lineHeight: 1.7 }}>
            ※ 週の合計は月次目標に一致します（<b>全週を達成すれば月間目標に到達</b>）。今週の残営業日が少ない週（例：月初の週）は、その分だけ週次目標も自動で小さく配分されます。
            実績は proposals（提案管理）由来のチーム全体。打ち合わせは実績集計対象外のため目標のみです。
          </div>
        </div>
      )}

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        ※ 初版は<b>全社（チーム）ビュー</b>です。売上目標・人員配分は月ごとに手動設定、KPIの割り振り・週配分・実現条件はAI/仮説モデルが算定します（AIキー未設定時は既定の転換率で逆算）。
        部署別・個人別、日次の予定×実績カレンダー、案件/人材の仕入れKPI（エンド直・FL・BP・PP採用）は今後の拡張予定です。
      </div>
    </div>
  );
}
