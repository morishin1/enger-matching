import { engerClient, dbConfigured } from "@/lib/supabase";
import { leadKpi } from "@/lib/quality";
import { currentAccess } from "@/lib/accounts";
import { currentPeriod } from "@/lib/billing";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

const ACTIVE_STAGES = ["返信待ち", "提案中", "面談調整", "クロージング中", "面談合格"];
const MET_STAGES = ["面談調整", "クロージング中", "面談合格", "稼働", "稼働決定"];
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
  // ロール判定：エージェントには活動指標のみ表示、金額系（売上/粗利）は管理者限定。
  const access = await currentAccess();
  const isAdmin = !access || access.role === "admin";
  let jobs: any[] = [], cands: any[] = [], proposals: any[] = [], engs: any[] = [], meetings: any[] = [];
  let bills: any[] = [];
  const period = currentPeriod();
  let setup = false;
  if (dbConfigured) {
    try {
      const sb = engerClient();
      [jobs, cands, proposals, engs, meetings] = await Promise.all([
        grab(sb, "jobs", "job_no, title, client_name, skills, salary_min, salary_max, is_published, outside_owner, operator, created_at", "job_no, title, client_name, created_at"),
        grab(sb, "candidates", "candidate_no, skills, rate, salary_min, salary_max, affiliation, title, status, operator, created_at", "candidate_no, skills, status, created_at"),
        grab(sb, "proposals", "id, stage, caller_status, created_at, stage_updated_at, proposer, closer, rate, score, ai_match, disqualified, lost_reason, company, job_title", "id, stage, created_at, rate"),
        grab(sb, "engagements", "id, proposal_id, monthly_rate, cost, end_date, status", "id, monthly_rate, status"),
        grab(sb, "meetings", "id, our_owner, new_or_existing, fb_sentiment, company_name, meeting_date", "id, our_owner"),
      ]);
      // 当月の billing_tasks（勤怠/請求の進捗）。テーブル未作成でも分析ページは動かす。
      try {
        const bt = await sb.from("billing_tasks").select("engagement_id, attendance_status, invoice_status").eq("period", period);
        if (!bt.error) bills = bt.data ?? [];
      } catch { /* ignore */ }
      if (!jobs.length && !proposals.length) setup = true;
    } catch { setup = true; }
  } else setup = true;

  const pub = jobs.filter((j) => j.is_published !== false);
  const liveEngs = engs.filter((e) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");

  // 稼働ダッシュボード（旧 /progress 上部のKPI）
  const engActive = engs.filter((e) => e.status === "稼働中").length;
  const engPlanned = engs.filter((e) => e.status === "予定").length;
  const engEnded = engs.filter((e) => e.status === "終了").length;
  const monthlyRevenueMan = engs.filter((e) => e.status === "稼働中").reduce((a, e) => a + (Number(e.monthly_rate) || 0), 0);
  const taskTarget = engs.filter((e) => e.status === "稼働中" || e.status === "予定");
  const billByEng = new Map(bills.map((b: any) => [b.engagement_id, b]));
  const invSent = (s?: string | null) => s === "送付完了" || s === "発行済";
  const attPending = taskTarget.filter((e) => (billByEng.get(e.id)?.attendance_status ?? "未") !== "確認済").length;
  const invPending = taskTarget.filter((e) => !invSent(billByEng.get(e.id)?.invoice_status)).length;

  // リード品質
  const kpi = leadKpi(proposals);
  const active = proposals.filter((p) => ACTIVE_STAGES.includes(p.stage) && !p.disqualified);
  const won = proposals.filter((p) => p.stage === "稼働" || p.stage === "稼働決定");

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
    if (p.stage === "稼働" || p.stage === "稼働決定") byProposer[who].won++;
  }
  const proposers = Object.entries(byProposer).sort((a, b) => (b[1].active + b[1].won) - (a[1].active + a[1].won)).slice(0, 10);

  // ===== 担当者別の動き＋改善提案（ルールベース診断） =====
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
    // 良い動き
    if (proposed >= 5 && meetRate >= 50) goods.push(`面談化が高い（${meetRate}%）`);
    if (won >= 3) goods.push(`稼働${won}件を獲得`);
    if (newMeetings >= 3) goods.push(`新規開拓が活発（新規打合せ${newMeetings}件）`);
    // 改善ポイント
    if (proposed >= 5 && meetRate < 30) issues.push(`提案は多い(${proposed})が面談化が弱い(${meetRate}%)。提案の質・初動フォローを見直し`);
    if (reached >= 4 && wonRate < 15) issues.push(`面談まで行くが決定率が低い(${wonRate}%)。条件すり合わせ・クロージング強化`);
    if (myMeetings.length >= 3 && ownedJobs === 0) issues.push(`打合せ(${myMeetings.length}件)はあるが担当案件0。ヒアリングから案件獲得への踏み込みを`);
    const negRate = myMeetings.length ? Math.round((myMeetings.filter((m) => (m.fb_sentiment ?? "").includes("ネガ")).length / myMeetings.length) * 100) : 0;
    if (myMeetings.length >= 3 && negRate >= 40) issues.push(`打合せのネガ反応が多い(${negRate}%)。訴求内容・ターゲットの見直し`);

    return { name, proposed, reached, meetRate, won, meetings: myMeetings.length, newMeetings, ownedJobs, goods, issues };
  }).filter((i) => i.proposed > 0 || i.meetings > 0 || i.ownedJobs > 0)
    .sort((a, b) => b.issues.length - a.issues.length || (b.proposed + b.meetings) - (a.proposed + a.meetings));

  // ===== 営業KPIスコアカード（担当者別・当月）=====
  // 売上につながる活動を「量→質→精度→スピード→成果」で見える化し、各自の達成を経営が管理する。
  const now2 = new Date();
  const monthStart = new Date(now2.getFullYear(), now2.getMonth(), 1).getTime();
  const monthLabel = `${now2.getFullYear()}/${now2.getMonth() + 1}`;
  const t = (d: any) => { if (!d) return 0; const x = new Date(d).getTime(); return isNaN(x) ? 0 : x; };
  const inMonth = (d: any) => t(d) >= monthStart;
  // 月間KPI目標（目安・あとで調整可）
  const KPI_TARGET = { regJobs: 8, regCands: 15, meetings: 8, proposed: 10, meetRate: 40, won: 2 };
  // 提案ID→クロージング担当（稼働売上の担当付けに使用）
  const closerOf = new Map<string, string>(proposals.map((p: any) => [p.id, p.closer || p.proposer || "未割当"]));
  const liveEngs2 = engs.filter((e: any) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");

  const kpiNames = new Set<string>();
  proposals.forEach((p: any) => { if (p.proposer) kpiNames.add(p.proposer); });
  meetings.forEach((m: any) => { if (m.our_owner) kpiNames.add(m.our_owner); });
  jobs.forEach((j: any) => { if (j.operator) kpiNames.add(j.operator); });
  cands.forEach((c: any) => { if (c.operator) kpiNames.add(c.operator); });

  type Score = { name: string; regJobs: number; regCands: number; meetings: number; proposed: number; reached: number; meetRate: number; won: number; confirmedMan: number; avgCloseDays: number | null; hit: number };
  const scorecard: Score[] = [...kpiNames].map((name) => {
    const regJobs = jobs.filter((j: any) => j.operator === name && inMonth(j.created_at)).length;
    const regCands = cands.filter((c: any) => c.operator === name && inMonth(c.created_at)).length;
    const myMtg = meetings.filter((m: any) => m.our_owner === name && (m.meeting_date ? inMonth(m.meeting_date) : true)).length;
    const myProp = proposals.filter((p: any) => p.proposer === name && !p.disqualified && inMonth(p.created_at));
    const proposed = myProp.length;
    const reached = myProp.filter((p: any) => MET_STAGES.includes(p.stage)).length;
    const meetRate = proposed ? Math.round((reached / proposed) * 100) : 0;
    const wonProps = proposals.filter((p: any) => (p.proposer === name || p.closer === name) && (p.stage === "稼働" || p.stage === "稼働決定") && inMonth(p.stage_updated_at ?? p.created_at));
    const won = wonProps.length;
    // 確定売上(月額)＝自分がクロージング担当の稼働中エンゲージメント合計
    const confirmedMan = liveEngs2.filter((e: any) => closerOf.get(e.proposal_id) === name).reduce((s: number, e: any) => s + parseManYen(e.monthly_rate), 0);
    // 平均クロージング日数＝今月の稼働化について 提案→稼働 までの日数
    const closeDays = wonProps.map((p: any) => (t(p.stage_updated_at) - t(p.created_at))).filter((ms: number) => ms > 0).map((ms: number) => Math.round(ms / 86400000));
    const avgCloseDays = closeDays.length ? Math.round(closeDays.reduce((a: number, b: number) => a + b, 0) / closeDays.length) : null;
    const hit = [regJobs >= KPI_TARGET.regJobs, regCands >= KPI_TARGET.regCands, myMtg >= KPI_TARGET.meetings, proposed >= KPI_TARGET.proposed, meetRate >= KPI_TARGET.meetRate, won >= KPI_TARGET.won].filter(Boolean).length;
    return { name, regJobs, regCands, meetings: myMtg, proposed, reached, meetRate, won, confirmedMan, avgCloseDays, hit };
  }).filter((s) => s.regJobs + s.regCands + s.meetings + s.proposed + s.won > 0)
    .sort((a, b) => b.hit - a.hit || b.won - a.won || (b.confirmedMan - a.confirmedMan));

  const kpiTone = (v: number, target: number) => v >= target ? "#067647" : v >= target * 0.5 ? "#b45309" : "#b42318";
  const judge = (hit: number) => hit >= 5 ? { l: "◎", c: "#067647", bg: "#e7f7ee" } : hit >= 3 ? { l: "○", c: "#b45309", bg: "#fff6e0" } : { l: "△", c: "#b42318", bg: "#fdecef" };

  // データ充足
  const jc = { skills: pub.filter((j) => j.skills?.length).length, salary: pub.filter((j) => j.salary_min || j.salary_max).length, client: pub.filter((j) => j.client_name).length, owner: pub.filter((j) => j.outside_owner).length };
  const cc = { skills: cands.filter((c) => c.skills?.length).length, rate: cands.filter((c) => c.rate || c.salary_min || c.salary_max).length, affiliation: cands.filter((c) => c.affiliation).length, title: cands.filter((c) => c.title).length };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Analytics · {isAdmin ? "管理者ビュー" : "エージェントビュー"}</div>
          <h1>分析 — 仮説立案ボード</h1>
          <div className="sub">「人数」ではなく<b style={{ color: "var(--color-ink)" }}>リード品質 × 各ステージの歩留まり</b>で見る。接触前失注・NGは母数から除外しています。</div>
        </div>
      </div>

      {setup && <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>データがまだありません。案件・提案が入るとここに集計が表示されます。</div>}

      {/* 稼働ダッシュボード（旧 /progress の上部から移動）。稼働の量と月初業務の未処理を俯瞰。 */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🛠 稼働ダッシュボード（{period}）</h3>
          <a href="/progress" style={{ fontSize: 11.5, color: "var(--color-brand-700)", textDecoration: "underline" }}>稼働管理を開く →</a>
        </div>
        <div className="kpi-grid">
          <div className="kpi brand">
            <div className="top"><div className="ico-box"><Icons.progress /></div><div className="chip flat">稼働</div></div>
            <div><div className="val tnum">{engActive}<span className="unit">名</span></div><div className="label">稼働中</div><div className="note">予定 {engPlanned} / 終了 {engEnded}</div></div>
          </div>
          {isAdmin && (
            <div className="kpi accent">
              <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">売上</div></div>
              <div><div className="val tnum">{monthlyRevenueMan.toLocaleString("ja-JP")}<span className="unit">万</span></div><div className="label">月次売上(稼働中)</div><div className="note">請求ベース</div></div>
            </div>
          )}
          <div className="kpi warn">
            <div className="top"><div className="ico-box"><Icons.clock /></div><div className="chip">勤怠</div></div>
            <div><div className="val tnum">{attPending}<span className="unit">件</span></div><div className="label">勤怠 未チェック</div><div className="note">{period}</div></div>
          </div>
          <div className="kpi warn">
            <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">請求</div></div>
            <div><div className="val tnum">{invPending}<span className="unit">件</span></div><div className="label">請求書 未送付</div><div className="note">{period}</div></div>
          </div>
        </div>
      </div>

      {/* KPIサマリー（売上・粗利は管理者限定） */}
      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{kpi.valid}</div><div className="label">有効リード</div><div className="note">全{kpi.total} − 接触前失注{kpi.preLost} − NG{kpi.ngExcluded}</div></div></div>
        <div className="kpi"><div><div className="val tnum">{kpi.postLostRate}<span className="unit">%</span></div><div className="label">接触後失注率</div><div className="note">接触後失注 {kpi.postLost}件</div></div></div>
        {isAdmin && <div className="kpi accent"><div><div className="val tnum">{yen(confirmedMan)}</div><div className="label">確定（稼働中の月額）</div><div className="note">見込み {yen(pipelineMan)}</div></div></div>}
        {isAdmin && <div className="kpi warn"><div><div className="val tnum">{grossMan == null ? "—" : yen(grossMan)}</div><div className="label">粗利（月額）</div><div className="note">{grossMan == null ? "原価データ未設定" : "売上−原価"}</div></div></div>}
        {!isAdmin && <div className="kpi"><div><div className="val tnum">{won.length}</div><div className="label">稼働化（成約）</div><div className="note">活動中の総数</div></div></div>}
        {!isAdmin && <div className="kpi"><div><div className="val tnum">{active.length}</div><div className="label">進行中の提案</div><div className="note">未失注・未NG</div></div></div>}
      </div>
      {!isAdmin && (
        <div className="muted" style={{ fontSize: 11, marginTop: -8 }}>※ 売上・粗利の金額は管理者のみ閲覧できます。エージェントには活動指標を表示しています。</div>
      )}

      {/* 営業KPIスコアカード（担当者別・当月） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🎯 営業KPIスコアカード（{monthLabel} 当月・担当者別）</h3>
          <span className="muted" style={{ fontSize: 11 }}>量→質→精度→スピード→成果。目標達成は緑、未達は赤。</span>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginBottom: 10 }}>
          月間目標の目安：案件登録 {KPI_TARGET.regJobs} / 人材登録 {KPI_TARGET.regCands} / 打合せ {KPI_TARGET.meetings} / 提案 {KPI_TARGET.proposed} / 面談化率 {KPI_TARGET.meetRate}% / 稼働化 {KPI_TARGET.won}
        </div>
        {scorecard.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>当月の活動データがありません。登録担当（人材/案件登録時の担当者）・提案者・打合せ担当が入ると集計されます。</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th>担当者</th>
                  <th className="num" title="量：案件登録（当月）">案件登録</th>
                  <th className="num" title="量：人材登録（当月）">人材登録</th>
                  <th className="num" title="量：打合せ件数（当月）">打合せ</th>
                  <th className="num" title="量：提案件数（当月）">提案</th>
                  <th className="num" title="精度：提案→面談到達率">面談化率</th>
                  <th className="num" title="スピード：提案→稼働の平均日数">クロージング日数</th>
                  <th className="num" title="成果：稼働化（成約）件数">稼働化</th>
                  {isAdmin && <th className="num" title="成果：自分がクローザーの稼働中 月額合計">確定売上</th>}
                  <th className="num" title="6指標のうち目標達成数">判定</th>
                </tr>
              </thead>
              <tbody>
                {scorecard.map((s) => {
                  const j = judge(s.hit);
                  return (
                    <tr key={s.name}>
                      <td style={{ fontWeight: 700 }}>{s.name}</td>
                      <td className="num" style={{ color: kpiTone(s.regJobs, KPI_TARGET.regJobs), fontWeight: 700 }}>{s.regJobs}</td>
                      <td className="num" style={{ color: kpiTone(s.regCands, KPI_TARGET.regCands), fontWeight: 700 }}>{s.regCands}</td>
                      <td className="num" style={{ color: kpiTone(s.meetings, KPI_TARGET.meetings), fontWeight: 700 }}>{s.meetings}</td>
                      <td className="num" style={{ color: kpiTone(s.proposed, KPI_TARGET.proposed), fontWeight: 700 }}>{s.proposed}</td>
                      <td className="num" style={{ color: kpiTone(s.meetRate, KPI_TARGET.meetRate), fontWeight: 700 }}>{s.meetRate}%</td>
                      <td className="num" style={{ color: "var(--color-ink-3)" }}>{s.avgCloseDays == null ? "—" : `${s.avgCloseDays}日`}</td>
                      <td className="num" style={{ color: kpiTone(s.won, KPI_TARGET.won), fontWeight: 700 }}>{s.won}</td>
                      {isAdmin && <td className="num" style={{ fontWeight: 700 }}>{s.confirmedMan ? yen(s.confirmedMan) : "—"}</td>}
                      <td className="num"><span style={{ fontWeight: 800, color: j.c, background: j.bg, borderRadius: 99, padding: "2px 10px" }}>{j.l} {s.hit}/6</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="muted" style={{ fontSize: 10.5, marginTop: 10 }}>
          ※ 「案件登録／人材登録」は登録時に選択中の担当者で集計します（トップ右の担当者バッジ）。過去データは担当不明のため0表示になることがあります。目標値は運用に合わせて調整できます。
        </div>
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

      {/* 担当者別の動き＋改善提案 */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🧭 担当者別の動き ＆ 改善提案</h3>
          <span className="muted" style={{ fontSize: 11 }}>提案→面談→稼働の歩留まり・打合せ・開拓を診断</span>
        </div>
        {insights.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>担当者の活動データがありません（提案者・打合せ担当・エンド担当が未設定）。</div>
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
        <div className="muted" style={{ fontSize: 10.5, marginTop: 10 }}>※ ルールに基づく自動診断です（AI不使用）。提案者・打合せ担当(our_owner)・エンド担当(outside_owner)の入力が揃うほど精度が上がります。</div>
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
