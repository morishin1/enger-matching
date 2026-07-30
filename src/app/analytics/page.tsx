import Link from "@/components/AppLink";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { FlowSteps } from "@/components/FlowSteps";
import { currentAccess } from "@/lib/accounts";
import { GripBoard } from "@/components/GripBoard";
import { GrowthStrategy } from "@/components/GrowthStrategy";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";

export const dynamic = "force-dynamic";

// 進行中ステージ。新名(所属確認/提案中/面談/合格)＋旧名を互換のため両方含める。
// 進行中ステージの正は proposal-constants.ts（画面ごとに一覧が違い件数が食い違っていたため共通化）
import { ACTIVE_STAGES } from "@/lib/proposal-constants";
const LOST_STAGES = ["見送り", "失注"];

// 分析タブの定義。URL ?tab=... で切替。デフォルトは育成戦略。
//   KPI推移は /kpi、ファネル本体は /funnel に集約済みのため、ここでは重複させず
//   「ここでしか見られないもの」だけに絞る：
//     ・育成戦略   ：市場×自社で狙う/育てる領域の方針
//     ・コーチング ：担当者別の動きと改善提案（マネージャー向け）
//     ・失注分析   ：失注理由・グリップボード・提案者別の動き
//     ・データ品質 ：案件/人材データの充足率（仮説の信頼性）
const TABS = [
  { key: "growth",  label: "育成戦略",   icon: "trending_up",      desc: "市場単価×トレンドで狙う領域/育てる領域を提示" },
  { key: "coach",   label: "コーチング", icon: "psychology",       desc: "担当者別の動きと改善提案" },
  { key: "lost",    label: "失注分析",   icon: "filter_alt",       desc: "失注理由ランキング・停滞案件・提案者別の動き" },
  { key: "quality", label: "データ品質", icon: "settings_suggest", desc: "データ充足率（仮説の信頼性）" },
] as const;
type TabKey = typeof TABS[number]["key"];

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

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "growth") as TabKey;

  // ロール判定：エージェントには活動指標のみ表示、金額系（売上/粗利）は管理者限定。
  //   ※ KPI集計・ファネル・稼働ダッシュボードは /kpi /funnel /progress 側に集約済みのため、
  //     ここでは育成戦略・コーチング・失注分析・データ品質に必要なデータだけを取る。
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";
  let jobs: any[] = [], cands: any[] = [], proposals: any[] = [], meetings: any[] = [];
  let setup = false;
  if (dbConfigured) {
    try {
      const sb = engerClient();
      [jobs, cands, proposals, meetings] = await Promise.all([
        grab(sb, "jobs", "job_no, title, client_name, skills, salary_min, salary_max, is_published, outside_owner, operator, created_at", "job_no, title, client_name, created_at"),
        grab(sb, "candidates", "candidate_no, skills, rate, salary_min, salary_max, affiliation, title, status, operator, created_at", "candidate_no, skills, status, created_at"),
        grab(sb, "proposals", "id, stage, caller_status, created_at, stage_updated_at, proposer, closer, rate, score, ai_match, disqualified, lost_reason, company, job_title", "id, stage, created_at, rate"),
        grab(sb, "meetings", "id, our_owner, new_or_existing, fb_sentiment, company_name, meeting_date", "id, our_owner"),
      ]);
      if (!jobs.length && !proposals.length) setup = true;
    } catch { setup = true; }
  } else setup = true;

  const pub = jobs.filter((j) => j.is_published !== false);

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
    if (p.stage === "稼働" || p.stage === "稼働決定") byProposer[who].won++;
  }
  const proposers = Object.entries(byProposer).sort((a, b) => (b[1].active + b[1].won) - (a[1].active + a[1].won)).slice(0, 10);

  // 担当者別の動き＋改善提案（ルールベース診断）
  const MET = ["面談調整", "クロージング中", "面談合格", "稼働", "稼働決定"];
  const WON = ["稼働", "稼働決定"];
  const names = new Set<string>();
  proposals.forEach((p) => { if (p.proposer) names.add(p.proposer); });
  meetings.forEach((m) => { if (m.our_owner) names.add(m.our_owner); });
  jobs.forEach((j) => { if (j.outside_owner) names.add(j.outside_owner); });

  type Insight = { name: string; proposed: number; reached: number; meetRate: number; won: number; meetings: number; newMeetings: number; ownedJobs: number; goods: string[]; issues: string[] };
  const insights: Insight[] = [...names].map((name) => {
    const mine = proposals.filter((p) => p.proposer === name && !p.disqualified);
    const proposed = mine.length;
    const reached = mine.filter((p) => MET.includes(p.stage)).length;
    const won = mine.filter((p) => WON.includes(p.stage)).length;
    const meetRate = proposed ? Math.round((reached / proposed) * 100) : 0;
    const wonRate = proposed ? Math.round((won / proposed) * 100) : 0;
    const myMeetings = meetings.filter((m) => m.our_owner === name);
    const newMeetings = myMeetings.filter((m) => m.new_or_existing === "新規").length;
    const ownedJobs = jobs.filter((j) => j.outside_owner === name && j.is_published !== false).length;

    const goods: string[] = []; const issues: string[] = [];
    if (proposed >= 5 && meetRate >= 50) goods.push(`面談化が高い（${meetRate}%）`);
    if (won >= 3) goods.push(`稼働${won}件を獲得`);
    if (newMeetings >= 3) goods.push(`新規開拓が活発（新規打合せ${newMeetings}件）`);
    if (proposed >= 5 && meetRate < 30) issues.push(`提案は多い(${proposed})が面談化が弱い(${meetRate}%)。提案の質・初動フォローを見直し`);
    if (reached >= 4 && wonRate < 15) issues.push(`面談まで行くが決定率が低い(${wonRate}%)。条件すり合わせ・クロージング強化`);
    if (myMeetings.length >= 3 && ownedJobs === 0) issues.push(`打合せ(${myMeetings.length}件)はあるが担当案件0。ヒアリングから案件獲得への踏み込みを`);
    const negRate = myMeetings.length ? Math.round((myMeetings.filter((m) => (m.fb_sentiment ?? "").includes("ネガ")).length / myMeetings.length) * 100) : 0;
    if (myMeetings.length >= 3 && negRate >= 40) issues.push(`打合せのネガ反応が多い(${negRate}%)。訴求内容・ターゲットの見直し`);

    return { name, proposed, reached, meetRate, won, meetings: myMeetings.length, newMeetings, ownedJobs, goods, issues };
  }).filter((i) => i.proposed > 0 || i.meetings > 0 || i.ownedJobs > 0)
    .sort((a, b) => b.issues.length - a.issues.length || (b.proposed + b.meetings) - (a.proposed + a.meetings));

  const jc = { skills: pub.filter((j) => j.skills?.length).length, salary: pub.filter((j) => j.salary_min || j.salary_max).length, client: pub.filter((j) => j.client_name).length, owner: pub.filter((j) => j.outside_owner).length };
  const cc = { skills: cands.filter((c) => c.skills?.length).length, rate: cands.filter((c) => c.rate || c.salary_min || c.salary_max).length, affiliation: cands.filter((c) => c.affiliation).length, title: cands.filter((c) => c.title).length };

  const Icon = ({ name, size = 18 }: { name: string; size?: number }) => (
    <span className="material-symbols-outlined" aria-hidden style={{ fontSize: size, lineHeight: 1, verticalAlign: "middle" }}>{name}</span>
  );

  return (
    <div className="page">
      <AnalyticsTabs />
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Analytics · 詳細分析（{isAdmin ? "管理者ビュー" : "エージェントビュー"}）</div>
          <h1>詳細分析</h1>
          <div className="sub">市場の<b>仮置きトレンド係数</b>と社内データを突き合わせ、<b>狙う領域・育てる領域</b>を見える化します。下のタブで切り替えて確認できます。</div>
        </div>
      </div>

      <FlowSteps current="progress" sub="詳細分析（狙う領域・育てる領域）" />

      {setup && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>データがまだありません。案件・提案が入るとここに集計が表示されます。</div>}

      {/* タブナビ */}
      <nav role="tablist" aria-label="分析タブ"
        style={{ display: "flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, overflowX: "auto" }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Link key={t.key} href={`/analytics?tab=${t.key}`} role="tab" aria-selected={on}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 14px", borderRadius: 8, textDecoration: "none",
                background: on ? "var(--color-surface)" : "transparent",
                color: on ? "var(--color-ink)" : "var(--color-ink-3)",
                boxShadow: on ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
                fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap",
              }}>
              <Icon name={t.icon} size={18} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* === 1. 育成戦略（デフォルト） === */}
      {tab === "growth" && (
        <GrowthStrategy jobs={jobs} candidates={cands} />
      )}

      {/* === 失注分析 === */}
      {tab === "lost" && (
        <>
          <GripBoard proposals={proposals} candidates={cands} jobs={jobs} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap, 20px)" }} className="duo-grid">
            <div className="card">
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>💔 失注理由</h3>
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

            <div className="card">
              <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>👥 提案者別の動き</h3>
              {proposers.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>提案データがありません。</div> : (
                <table className="tbl"><thead><tr><th>提案者</th><th className="num">進行中</th><th className="num">決定</th>{isAdmin && <th className="num">取扱見込み</th>}</tr></thead>
                  <tbody>
                    {proposers.map(([who, v]) => (
                      <tr key={who}><td style={{ fontWeight: 600 }}>{who}</td><td className="num">{v.active}</td><td className="num">{v.won}</td>{isAdmin && <td className="num">{yen(v.man)}</td>}</tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* === 4. コーチング === */}
      {tab === "coach" && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🧭 担当者別の動き ＆ 改善提案</h3>
            <span className="muted" style={{ fontSize: 11 }}>提案→面談→稼働の歩留まり・打合せ・開拓を診断</span>
          </div>
          {insights.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>担当者の活動データがありません。</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {insights.map((p) => (
                <div key={p.name} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <b style={{ fontSize: 13.5 }}>{p.name}</b>
                    <span className="muted mono" style={{ fontSize: 10.5 }}>面談化 {p.meetRate}%</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11.5, color: "var(--color-ink-3)" }}>
                    <span>提案 <b style={{ color: "var(--color-ink)" }}>{p.proposed}</b></span>
                    <span>面談 <b style={{ color: "var(--color-ink)" }}>{p.reached}</b></span>
                    <span>稼働 <b style={{ color: "var(--color-ink)" }}>{p.won}</b></span>
                    <span>打合せ <b style={{ color: "var(--color-ink)" }}>{p.meetings}</b>{p.newMeetings ? `(新規${p.newMeetings})` : ""}</span>
                    <span>担当案件 <b style={{ color: "var(--color-ink)" }}>{p.ownedJobs}</b></span>
                  </div>
                  {p.goods.map((g, i) => <div key={`g${i}`} style={{ fontSize: 11.5, color: "#067647" }}>👍 {g}</div>)}
                  {p.issues.length > 0 ? p.issues.map((s, i) => (
                    <div key={`i${i}`} style={{ fontSize: 11.5, color: "#b42318", background: "#fdecef", borderRadius: 8, padding: "6px 9px" }}>💡 {s}</div>
                  )) : (p.goods.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>大きな課題は検出されていません。</div>)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* === データ品質（仮説の信頼性） === */}
      {tab === "quality" && (
        <>
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
            <div className="muted" style={{ fontSize: 10.5, marginTop: 10 }}>※ 充足率が低い項目は、その軸での仮説の信頼性が下がります。</div>
          </div>
        </>
      )}
    </div>
  );
}
