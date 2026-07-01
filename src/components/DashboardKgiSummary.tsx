// ダッシュボード先頭の「今月のKGI/KPI」サマリー。/kgi と同じデータ源に連動して、
//   売上目標・稼働/面談/提案/打合せ の月次目標＆達成率、仕入れKGI（案件/人材情報の獲得率）を要約表示する。
//   サーバーコンポーネント（async）。失敗しても画面が落ちないよう握りつぶす。
import type { CSSProperties } from "react";
import Link from "@/components/AppLink";
import { businessDaysInMonth } from "@/lib/person-kgi";
import { getKgiSalesPlan, type KgiPlan } from "@/lib/kgi-plan";
import { getKpiSnapshot, getMeetingKgi, type Metric } from "@/lib/kpi";

const two = (n: number) => String(n).padStart(2, "0");
const toneOf = (pct: number | null) =>
  pct == null ? "var(--color-ink-4)" : pct >= 100 ? "#067647" : pct >= 80 ? "#0095D9" : pct >= 50 ? "#b45309" : "#b42318";
const pctOf = (a: number, t: number): number | null => (t > 0 ? Math.round((a / t) * 100) : (a > 0 ? 100 : null));

export async function DashboardKgiSummary() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const mk = `${y}-${two(m)}-01`;
  const bizDays = businessDaysInMonth(mk);

  let salesTarget: number | null = null;
  let plan: KgiPlan | null = null;
  try {
    const row = await getKgiSalesPlan(mk);
    salesTarget = row?.salesTargetMan ?? null;
    plan = row?.plan ?? null;
  } catch { /* 未整備でも続行 */ }

  // 実績（提案/面談/稼働）＝ proposals 由来（当月累計）。
  const actual: Partial<Record<Metric, number>> = {};
  try {
    const snap = await getKpiSnapshot({ ownerName: null, type: "month", base: new Date(`${mk}T12:00:00+09:00`) });
    for (const k of ["proposal", "schedule", "deal"] as Metric[]) actual[k] = snap.snapshot[k]?.actual ?? 0;
  } catch { /* KPI未整備でも続行 */ }

  // 打ち合わせ実績＋仕入れKGI（案件/人材情報の獲得）＝ meetings 由来。
  const lastDom = new Date(y, m, 0).getDate();
  let meetings = 0, jobInfoMeetings = 0, candInfoMeetings = 0, jobInfoCount = 0, candInfoCount = 0;
  try {
    const mk2 = await getMeetingKgi({ ownerName: null, monthFromISO: mk, monthToISO: `${y}-${two(m)}-${two(lastDom)}`, weeks: [] });
    ({ meetings, jobInfoMeetings, candInfoMeetings, jobInfoCount, candInfoCount } = mk2.month);
  } catch { /* 打合せ記録未整備でも続行 */ }

  const card: CSSProperties = { padding: "12px 14px", borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-surface)" };
  const label: CSSProperties = { fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 };

  // 割り振り済みプランがある場合の KPI 行（月次目標＋当月実績＋達成率）。
  const KPIS: { key: "placement" | "meeting" | "proposal" | "appointment"; label: string; act: number }[] = plan ? [
    { key: "placement", label: "稼働", act: actual.deal ?? 0 },
    { key: "meeting", label: "面談", act: actual.schedule ?? 0 },
    { key: "proposal", label: "提案", act: actual.proposal ?? 0 },
    { key: "appointment", label: "打合せ", act: meetings },
  ] : [];

  const jobRate = pctOf(jobInfoMeetings, meetings);
  const candRate = pctOf(candInfoMeetings, meetings);

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-brand-700)" }}>insights</span>
        <b style={{ fontSize: 14 }}>今月のKGI/KPI（{y}年{m}月）</b>
        <span className="muted" style={{ fontSize: 11 }}>営業日 {bizDays}日</span>
        <Link href="/kgi" prefetch={false} className="btn ghost btn-xs" style={{ marginLeft: "auto", textDecoration: "none" }}>詳細・目標設定 →</Link>
      </div>

      {!plan ? (
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>
          月間売上目標が未設定です。<Link href="/kgi" prefetch={false} style={{ color: "var(--color-brand-700)", fontWeight: 700 }}>KGI/KPI</Link> で売上目標と人員を設定すると、必要な提案数・面談数・稼働人数・打合せ数と達成率がここに表示されます。
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {/* 売上目標＋主要KPIの達成率 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
            <div style={card}>
              <div style={label}>月間売上目標</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 800 }}>{salesTarget != null ? `${salesTarget.toLocaleString("ja-JP")}万` : "—"}</div>
            </div>
            {KPIS.map((k) => {
              const tgt = plan!.monthly[k.key] ?? 0;
              const p = pctOf(k.act, tgt);
              return (
                <div key={k.key} style={card}>
                  <div style={label}>{k.label}</div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>{k.act}<span style={{ fontSize: 12, color: "var(--color-ink-4)", fontWeight: 600 }}> / {tgt}</span></div>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 800, color: toneOf(p) }}>{p == null ? "—" : `${p}%`}</div>
                </div>
              );
            })}
          </div>
          {/* 仕入れKGI：打合せ→案件/人材情報の獲得 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div style={{ ...card, background: "var(--color-surface-inset)" }}>
              <div style={label}>案件情報の獲得（今月）</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: "#0e7490" }}>{jobInfoCount}件 <span style={{ fontSize: 12, color: toneOf(jobRate) }}>獲得率 {jobRate ?? 0}%</span></div>
              <div className="muted" style={{ fontSize: 10.5 }}>打合せ {meetings}件中 {jobInfoMeetings}件で獲得</div>
            </div>
            <div style={{ ...card, background: "var(--color-surface-inset)" }}>
              <div style={label}>人材情報の獲得（今月）</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: "#7c3aed" }}>{candInfoCount}件 <span style={{ fontSize: 12, color: toneOf(candRate) }}>獲得率 {candRate ?? 0}%</span></div>
              <div className="muted" style={{ fontSize: 10.5 }}>打合せ {meetings}件中 {candInfoMeetings}件で獲得</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
