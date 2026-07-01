// KGI/KPI ダッシュボード。
//   月間売上目標（手動）→ AIが逆算して 稼働人数/面談/提案/打ち合わせ の月次KPIに割り振り、
//   当月の営業日数で週次・日次に按分して「チームで達成する」目標として表示する。
//   実績（提案/面談/稼働）は proposals 由来（getKpiSnapshot）で達成率を併記。
import type { CSSProperties } from "react";
import Link from "@/components/AppLink";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { businessDaysInMonth } from "@/lib/person-kgi";
import { getKgiSalesPlan, type KgiMonthly } from "@/lib/kgi-plan";
import { KgiPlanControls } from "@/components/KgiPlanControls";
import { getKpiSnapshot, type Metric } from "@/lib/kpi";

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
  const plan = planRow?.plan ?? null;

  // チーム実績（今月・全社）：提案/面談/稼働 の件数。
  let actualByMetric: Partial<Record<Metric, number>> = {};
  try {
    const snap = await getKpiSnapshot({ ownerName: null, type: "month", base: new Date(`${mk}T12:00:00+09:00`) });
    for (const k of ["proposal", "schedule", "deal"] as Metric[]) actualByMetric[k] = snap.snapshot[k]?.actual ?? 0;
  } catch { /* KPI未整備でも続行 */ }

  const th: CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 13.5, borderTop: "1px solid var(--color-border)" };
  const tdR: CSSProperties = { ...td, textAlign: "right" };

  const weekly = (monthlyN: number) => bizDays > 0 ? (monthlyN * 5) / bizDays : 0; // 1週=営業日5日
  const daily = (monthlyN: number) => bizDays > 0 ? monthlyN / bizDays : 0;

  return (
    <div className="page">
      {/* ヘッダ */}
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div style={{ maxWidth: 820 }}>
          <div className="meta">KGI / KPI · ダッシュボード</div>
          <h1><span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28, verticalAlign: "-5px", marginRight: 8, color: "var(--color-brand-700)" }}>insights</span>KGI/KPI ダッシュボード</h1>
          <div className="sub">
            <b>月間の売上目標を手動で設定</b>すると、達成に必要な<b>提案数・面談数・稼働人数・打ち合わせ数</b>をAIが逆算し、
            当月の営業日数で<b>週次・日次</b>に割り振ります。これをチームで達成する方式です。
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

      {/* 売上目標（手動）＋ AI計算 */}
      <KgiPlanControls month={mk} initialTarget={salesTarget} hasPlan={!!plan} canEdit={canEdit} />

      {/* サマリー：売上目標＆前提 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>月間売上目標</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 800 }}>{salesTarget != null ? `${salesTarget.toLocaleString("ja-JP")}万` : "未設定"}</div>
          <div className="muted" style={{ fontSize: 11 }}>当月の営業日 {bizDays}日（土日除く）</div>
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

      {!plan && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5 }}>
          {salesTarget == null
            ? <><b>まず月間売上目標を入力してください。</b> その後「AIで週次/日次KPIを計算」を押すと、必要な提案数・面談数・稼働人数・打ち合わせ数が割り振られます。</>
            : <><b>「AIで週次/日次KPIを計算」を押してください。</b> 売上目標 {salesTarget?.toLocaleString("ja-JP")}万円 から逆算します。</>}
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
                  return (
                    <tr key={key}>
                      <td style={td}><b>{label}</b></td>
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

      <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
        ※ 初版は<b>全社（チーム）ビュー</b>です。売上目標は月ごとに手動設定、KPIの割り振りはAIが逆算します（AIキー未設定時は既定の転換率で逆算）。
        部署別・個人別、日次カレンダー（予定×実績）、リカバリー自動配分は今後の拡張予定です。
      </div>
    </div>
  );
}
