// ファネル（転換率）分析ページ。管理者・マネージャー/リーダー向け。
//   Phase 0：自社の歩留まりを知る → ボトルネック特定 → KGIからKPI逆算の早見表。

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { getFunnel, resolveFunnelPeriod, rate, pct, type FunnelPeriod, type FunnelCounts } from "@/lib/funnel";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";

export const dynamic = "force-dynamic";

const PERIODS: { key: FunnelPeriod; label: string }[] = [
  { key: "this_month", label: "今月" },
  { key: "last_month", label: "先月" },
  { key: "last_3_months", label: "直近3ヶ月" },
];

const STAGES: { key: keyof FunnelCounts; label: string; tone: string }[] = [
  { key: "proposal", label: "提案", tone: "#0095D9" },
  { key: "meeting", label: "面談", tone: "#475569" },
  { key: "cl", label: "クロージング", tone: "#7c3aed" },
  { key: "won", label: "稼働化", tone: "#067647" },
];

export default async function FunnelPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";
  const isManager = !!access && canManageDept(access.teamRole);
  if (!isAdmin && !isManager) redirect("/");

  const sp = await searchParams;
  const periodKey: FunnelPeriod = (["this_month", "last_month", "last_3_months"].includes(sp.p ?? "") ? sp.p : "this_month") as FunnelPeriod;
  const { start, end, label } = resolveFunnelPeriod(periodKey);
  const f = await getFunnel(start, end, label);

  const t = f.total;
  // 各段階の転換率
  const rPM = rate(t.meeting, t.proposal);   // 提案→面談
  const rMC = rate(t.cl, t.meeting);         // 面談→CL
  const rCW = rate(t.won, t.cl);             // CL→稼働化
  const rPW = rate(t.won, t.proposal);       // 総合 提案→稼働化
  const transitions = [
    { label: "提案 → 面談", r: rPM },
    { label: "面談 → CL", r: rMC },
    { label: "CL → 稼働化", r: rCW },
  ];
  // ボトルネック＝転換率が最も低い遷移（算出可能なもののみ）
  const calcable = transitions.filter((x) => x.r != null) as { label: string; r: number }[];
  const bottleneck = calcable.length > 0 ? calcable.reduce((a, b) => (b.r < a.r ? b : a)) : null;

  // 逆算：稼働化1件に必要な提案数 = 1 / 総合転換率
  const propsPerWon = rPW && rPW > 0 ? Math.ceil(1 / rPW) : null;

  const maxCount = Math.max(t.proposal, t.meeting, t.cl, t.won, 1);

  return (
    <div className="page">
      <AnalyticsTabs />
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Funnel · 転換率分析</div>
          <h1>ファネル（転換率）</h1>
          <div className="sub">提案→面談→クロージング→稼働化の歩留まりを見ます。まず自社の転換率を知り、ボトルネックを特定し、KGI（稼働数）から必要な提案数を逆算します。</div>
        </div>
      </div>

      {/* 期間切替 */}
      <div className="card" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span className="meta" style={{ marginRight: 4 }}>期間</span>
        {PERIODS.map((p) => {
          const on = p.key === periodKey;
          return (
            <Link key={p.key} href={`/funnel?p=${p.key}`} style={{
              fontSize: 12, padding: "5px 14px", borderRadius: 99, textDecoration: "none",
              border: `1px solid ${on ? "var(--color-brand-600)" : "var(--color-border)"}`,
              background: on ? "var(--color-brand-600)" : "var(--color-surface)",
              color: on ? "#fff" : "var(--color-ink-2)", fontWeight: on ? 700 : 600,
            }}>{p.label}</Link>
          );
        })}
      </div>

      {!f.available ? (
        <div className="card"><div className="muted" style={{ fontSize: 12 }}>データを取得できませんでした（テーブル未整備の可能性）。</div></div>
      ) : (
        <>
          {/* ファネル本体 */}
          <div className="card">
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>📊 {f.periodLabel}のファネル（全社）</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {STAGES.map((s, i) => {
                const val = t[s.key];
                const w = Math.max(4, Math.round((val / maxCount) * 100));
                const prev = i > 0 ? t[STAGES[i - 1].key] : null;
                const conv = prev != null ? rate(val, prev) : null;
                return (
                  <div key={s.key} style={{ display: "grid", gridTemplateColumns: "92px 1fr 120px", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-2)" }}>{s.label}</span>
                    <div style={{ height: 30, borderRadius: 7, background: "var(--color-surface-inset)", overflow: "hidden" }}>
                      <div style={{ width: `${w}%`, height: "100%", background: s.tone, display: "flex", alignItems: "center", paddingLeft: 10, color: "#fff", fontWeight: 800, fontSize: 13 }} className="mono">
                        {val}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, color: "var(--color-ink-3)", textAlign: "right" }}>
                      {conv != null ? `前段比 ${pct(conv)}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
              ※ 期間内フローでの歩留まり目安（厳密なコホート追跡ではありません）。失注 {t.lost} 件。
            </div>
          </div>

          {/* 転換率カード＋ボトルネック */}
          <div className="card">
            <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>🔁 転換率とボトルネック</h3>
            <div className="kpi-grid" style={{ marginBottom: 12 }}>
              <RateCard label="提案 → 面談" r={rPM} />
              <RateCard label="面談 → CL" r={rMC} />
              <RateCard label="CL → 稼働化" r={rCW} />
              <RateCard label="総合（提案→稼働化）" r={rPW} highlight />
            </div>
            {bottleneck ? (
              <div style={{ padding: 12, borderRadius: 10, border: "1px solid #d97706", background: "rgba(217,119,6,.06)" }}>
                <span style={{ fontSize: 12.5, fontWeight: 800 }}>⚠️ ボトルネックは「{bottleneck.label}」（{pct(bottleneck.r)}）</span>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  ここの転換率を上げるのが稼働数を伸ばす一番の近道です。原因（提案の質／面談設計／クロージング）をチームで深掘りしましょう。
                </div>
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>転換率を算出するにはデータが不足しています。まずは活動量を貯めましょう。</div>
            )}
          </div>

          {/* KGI→KPI 逆算の早見表 */}
          <div className="card">
            <h3 style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700 }}>🎯 KGI→KPI 逆算の早見表</h3>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
              いまの総合転換率（提案→稼働化 {pct(rPW)}）を前提に、稼働化の目標に必要な提案数・面談数の目安です。
            </div>
            {propsPerWon == null ? (
              <div className="muted" style={{ fontSize: 12 }}>稼働化の実績がまだ無いため逆算できません。今月の稼働化が出たら表示されます。</div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, marginBottom: 10 }}>
                  稼働化を <b>1件</b> 増やすのに必要な提案 ≈ <b className="mono" style={{ color: "var(--color-brand-700)", fontSize: 16 }}>{propsPerWon}</b> 件
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--color-ink-4)", fontSize: 11 }}>
                      <th style={{ padding: "6px 8px" }}>稼働化の目標</th>
                      <th style={{ padding: "6px 8px" }}>必要な提案数</th>
                      <th style={{ padding: "6px 8px" }}>必要な面談数</th>
                      <th style={{ padding: "6px 8px" }}>必要なCL数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 3, 5, 10].map((n) => {
                      const needProp = rPW && rPW > 0 ? Math.ceil(n / rPW) : null;
                      const needMeet = rMC && rMC > 0 && rCW && rCW > 0 ? Math.ceil(n / (rMC * rCW)) : null;
                      const needCl = rCW && rCW > 0 ? Math.ceil(n / rCW) : null;
                      return (
                        <tr key={n} style={{ borderTop: "1px solid var(--color-border)" }}>
                          <td style={{ padding: "8px", fontWeight: 700 }}>+{n} 名</td>
                          <td className="mono" style={{ padding: "8px" }}>{needProp ?? "—"} 件</td>
                          <td className="mono" style={{ padding: "8px" }}>{needMeet ?? "—"} 件</td>
                          <td className="mono" style={{ padding: "8px" }}>{needCl ?? "—"} 件</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                  この提案数 ÷ メンバー数 ÷ 営業日数 が、1人あたりの日次・週次KPI（提案目標）になります。
                  <Link href="/settings/team-kgi" style={{ marginLeft: 6, color: "var(--color-brand-700)", textDecoration: "none" }}>チームKGIを設定 →</Link>
                </div>
              </>
            )}
          </div>

          {/* 部署別ファネル */}
          {f.byDept.length > 0 && (
            <div className="card">
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>🏢 部署別ファネル</h3>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--color-ink-4)", fontSize: 11 }}>
                    <th style={{ padding: "6px 8px" }}>部署</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>提案</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>面談</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>CL</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>稼働化</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>総合転換率</th>
                  </tr>
                </thead>
                <tbody>
                  {f.byDept.map((d) => {
                    const r = rate(d.counts.won, d.counts.proposal);
                    return (
                      <tr key={d.dept} style={{ borderTop: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "8px", fontWeight: 700 }}>{d.dept}</td>
                        <td className="mono" style={{ padding: "8px", textAlign: "right" }}>{d.counts.proposal}</td>
                        <td className="mono" style={{ padding: "8px", textAlign: "right" }}>{d.counts.meeting}</td>
                        <td className="mono" style={{ padding: "8px", textAlign: "right" }}>{d.counts.cl}</td>
                        <td className="mono" style={{ padding: "8px", textAlign: "right", color: "#067647", fontWeight: 700 }}>{d.counts.won}</td>
                        <td className="mono" style={{ padding: "8px", textAlign: "right" }}>{pct(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
                ※ 提案・CL・稼働化は提案者（不明時はクローザー）の部署、面談は打合せ担当の部署で集計。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RateCard({ label, r, highlight }: { label: string; r: number | null; highlight?: boolean }) {
  return (
    <div className={`kpi${highlight ? " brand" : ""}`}>
      <div>
        <div className="val tnum">{pct(r)}</div>
        <div className="label">{label}</div>
      </div>
    </div>
  );
}
