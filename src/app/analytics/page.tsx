import { engerClient, dbConfigured } from "@/lib/supabase";
import { leadKpi } from "@/lib/quality";

export const dynamic = "force-dynamic";

const ACTIVE_STAGES = ["未対応", "提案中", "面談調整", "クロージング中"];
const MET_STAGES = ["面談調整", "クロージング中", "稼働決定"];
const LOST_STAGES = ["見送り", "失注"];

function parseManYen(rate?: string | number | null): number {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate >= 10000 ? Math.round(rate / 10000) : Math.round(rate);
  const m = String(rate).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/万/.test(rate)) return Math.round(n);
  if (n >= 10000) n = n / 10000;
  return Math.round(n);
}
const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${man.toLocaleString("ja-JP")}万円`);

async function grab(sb: any, table: string, rich: string, base: string, limit = 2000) {
  try {
    let r = await sb.from(table).select(rich).limit(limit);
    if (r.error) r = await sb.from(table).select(base).limit(limit);
    return r.error ? [] : (r.data ?? []);
  } catch { return []; }
}

function CoverageBar({ label, filled, total }: { label: string; filled: number; total: number }) {
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const tone = pct >= 80 ? "#067647" : pct >= 50 ? "#b45309" : "#b42318";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(72px,120px) 1fr 84px", gap: 10, alignItems: "center" }}>
      <span style={{ fontSize: 12, color: "var(--color-ink-2)" }}>{label}</span>
      <div style={{ height: 8, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: tone, borderRadius: 99 }} />
      </div>
      <span className="mono" style={{ fontSize: 11.5, color: tone, fontWeight: 700, textAlign: "right" }}>{pct}% <span style={{ color: "var(--color-ink-4)", fontWeight: 400 }}>({filled}/{total})</span></span>
    </div>
  );
}

export default async function AnalyticsPage() {
  let jobs: any[] = [], cands: any[] = [], proposals: any[] = [], engs: any[] = [];
  let setup = false;
  if (dbConfigured) {
    try {
      const sb = engerClient();
      [jobs, cands, proposals, engs] = await Promise.all([
        grab(sb, "jobs", "job_no, title, client_name, skills, salary_min, salary_max, is_published, outside_owner, created_at", "job_no, title, client_name, created_at"),
        grab(sb, "candidates", "candidate_no, skills, rate, salary_min, salary_max, affiliation, title, status, created_at", "candidate_no, skills, status, created_at"),
        grab(sb, "proposals", "id, stage, caller_status, created_at, proposer, closer, rate, score, ai_match, disqualified, lost_reason, company, job_title", "id, stage, created_at, rate"),
        grab(sb, "engagements", "id, monthly_rate, cost, end_date, status", "id, monthly_rate, status"),
      ]);
      if (!jobs.length && !proposals.length) setup = true;
    } catch { setup = true; }
  } else setup = true;

  const pub = jobs.filter((j) => j.is_published !== false);
  const liveEngs = engs.filter((e) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");

  // リード品質
  const kpi = leadKpi(proposals);
  const active = proposals.filter((p) => ACTIVE_STAGES.includes(p.stage) && !p.disqualified);
  const won = proposals.filter((p) => p.stage === "稼働決定");

  // ファネル
  const funnel = [
    { k: "案件(公開)", n: pub.length },
    { k: "提案", n: proposals.length },
    { k: "面談到達", n: proposals.filter((p) => MET_STAGES.includes(p.stage)).length },
    { k: "稼働", n: liveEngs.length || won.length },
  ];
  const fMax = Math.max(1, ...funnel.map((f) => f.n));

  // お金
  const pipelineMan = active.reduce((s, p) => s + parseManYen(p.rate), 0);
  const confirmedMan = liveEngs.reduce((s, e) => s + parseManYen(e.monthly_rate), 0);
  const hasCost = engs.some((e) => e.cost != null);
  const grossMan = hasCost ? liveEngs.reduce((s, e) => s + (parseManYen(e.monthly_rate) - parseManYen(e.cost)), 0) : null;

  // 失注理由ランキング
  const lostRows = proposals.filter((p) => LOST_STAGES.includes(p.stage));
  const reasonCount: Record<string, number> = {};
  for (const p of lostRows) { const k = p.lost_reason || "（理由未入力）"; reasonCount[k] = (reasonCount[k] ?? 0) + 1; }
  const reasons = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const reasonMax = Math.max(1, ...reasons.map(([, n]) => n));

  // 担当者別（提案者）
  const byProposer: Record<string, { active: number; won: number; man: number }> = {};
  for (const p of proposals) {
    const who = p.proposer || "未割当";
    byProposer[who] ??= { active: 0, won: 0, man: 0 };
    if (ACTIVE_STAGES.includes(p.stage) && !p.disqualified) { byProposer[who].active++; byProposer[who].man += parseManYen(p.rate); }
    if (p.stage === "稼働決定") byProposer[who].won++;
  }
  const proposers = Object.entries(byProposer).sort((a, b) => (b[1].active + b[1].won) - (a[1].active + a[1].won)).slice(0, 10);

  // データ充足
  const jc = { skills: pub.filter((j) => j.skills?.length).length, salary: pub.filter((j) => j.salary_min || j.salary_max).length, client: pub.filter((j) => j.client_name).length, owner: pub.filter((j) => j.outside_owner).length };
  const cc = { skills: cands.filter((c) => c.skills?.length).length, rate: cands.filter((c) => c.rate || c.salary_min || c.salary_max).length, affiliation: cands.filter((c) => c.affiliation).length, title: cands.filter((c) => c.title).length };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Analytics · 管理者ビュー</div>
          <h1>分析 — 仮説立案ボード</h1>
          <div className="sub">「人数」ではなく<b style={{ color: "var(--color-ink)" }}>リード品質 × 各ステージの歩留まり</b>で見る。接触前失注・NGは母数から除外しています。</div>
        </div>
      </div>

      {setup && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>データがまだありません。案件・提案が入るとここに集計が表示されます。</div>}

      {/* KPIサマリー */}
      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{kpi.valid}</div><div className="label">有効リード</div><div className="note">全{kpi.total} − 接触前失注{kpi.preLost} − NG{kpi.ngExcluded}</div></div></div>
        <div className="kpi"><div><div className="val tnum">{kpi.postLostRate}<span className="unit">%</span></div><div className="label">接触後失注率</div><div className="note">接触後失注 {kpi.postLost}件</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{yen(confirmedMan)}</div><div className="label">確定（稼働中の月額）</div><div className="note">見込み {yen(pipelineMan)}</div></div></div>
        <div className="kpi warn"><div><div className="val tnum">{grossMan == null ? "—" : yen(grossMan)}</div><div className="label">粗利（月額）</div><div className="note">{grossMan == null ? "原価データ未設定" : "売上−原価"}</div></div></div>
      </div>

      {/* ファネル */}
      <div className="card">
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>📊 ファネル（案件 → 提案 → 面談 → 稼働）</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {funnel.map((f, i) => (
            <div key={f.k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, color: "var(--color-ink-2)", fontWeight: 600 }}>{f.k}</span>
                {i > 0 && <span className="muted mono" style={{ fontSize: 10 }}>{funnel[i - 1].n ? Math.round((f.n / funnel[i - 1].n) * 100) : 0}%</span>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{f.n}<span style={{ fontSize: 11, color: "var(--color-ink-4)", marginLeft: 3 }}>件</span></div>
              <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}><div style={{ width: `${(f.n / fMax) * 100}%`, height: "100%", background: "var(--color-brand-600)", borderRadius: 99 }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap, 20px)" }} className="duo-grid">
        {/* 失注理由 */}
        <div className="card">
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>💔 失注理由（接触後の改善材料）</h3>
          {reasons.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>失注データがありません。</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {reasons.map(([r, n]) => (
                <div key={r} style={{ display: "grid", gridTemplateColumns: "minmax(110px,200px) 1fr 36px", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r}</span>
                  <div style={{ height: 8, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${(n / reasonMax) * 100}%`, height: "100%", background: "var(--color-danger,#d23f57)", borderRadius: 99 }} /></div>
                  <span className="mono" style={{ fontSize: 11.5, textAlign: "right", fontWeight: 700 }}>{n}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 担当者別 */}
        <div className="card">
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>👥 提案者別の動き</h3>
          {proposers.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>提案データがありません。</div> : (
            <table className="tbl"><thead><tr><th>提案者</th><th className="num">進行中</th><th className="num">決定</th><th className="num">取扱見込み</th></tr></thead>
              <tbody>
                {proposers.map(([who, v]) => (
                  <tr key={who}><td style={{ fontWeight: 600 }}>{who}</td><td className="num">{v.active}</td><td className="num">{v.won}</td><td className="num">{yen(v.man)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* データ充足 */}
      <div className="card">
        <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>📋 重要データの充足率（仮説の信頼性）</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }} className="duo-grid">
          <div>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>案件（{pub.length}件）</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <CoverageBar label="スキル" filled={jc.skills} total={pub.length} />
              <CoverageBar label="単価" filled={jc.salary} total={pub.length} />
              <CoverageBar label="クライアント" filled={jc.client} total={pub.length} />
              <CoverageBar label="エンド担当" filled={jc.owner} total={pub.length} />
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>人材（{cands.length}名）</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <CoverageBar label="スキル" filled={cc.skills} total={cands.length} />
              <CoverageBar label="単価" filled={cc.rate} total={cands.length} />
              <CoverageBar label="所属区分" filled={cc.affiliation} total={cands.length} />
              <CoverageBar label="職種" filled={cc.title} total={cands.length} />
            </div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 10 }}>※ 充足率が低い項目は、その軸での仮説の信頼性が下がります。まず充足率を上げてから歩留まり改善の打ち手を検証しましょう。</div>
      </div>
    </div>
  );
}
