import Link from "@/components/AppLink";
import { rateToMan } from "@/lib/rate";
import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { DailyBriefing } from "./DailyBriefing";
import { IssueBoard, type Issue } from "./IssueBoard";
import { Collapsible } from "./Collapsible";
import { leadKpi, isContacted } from "@/lib/quality";

// 進行中ステージ。新名(所属確認/提案中/面談/合格)＋旧名を互換のため両方含める。
const ACTIVE_STAGES = ["所属確認", "提案中", "面談", "合格", "提案済", "返信待ち", "面談調整", "クロージング中", "面談合格"];
const MET_STAGES = ["面談", "合格", "面談調整", "クロージング中", "面談合格", "稼働", "稼働決定"];
const DAY = 86400000;

// 単価の解釈は src/lib/rate.ts に集約している（画面ごとに写すと解釈がズレるため）
const daysAgo = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : 99999);
const daysUntil = (d?: string | null) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / DAY) : null);
const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(1)}億円` : `${man.toLocaleString("ja-JP")}万円`);
const todayStr = () => new Date().toISOString().slice(0, 10);

async function grab(sb: any, table: string, rich: string, base: string, limit = 800): Promise<{ rows: any[]; ok: boolean }> {
  try {
    let r = await sb.from(table).select(rich).limit(limit);
    if (r.error) r = await sb.from(table).select(base).limit(limit);
    if (r.error) return { rows: [], ok: false };
    return { rows: r.data ?? [], ok: true };
  } catch { return { rows: [], ok: false }; }
}

// 小さな統計タイル
function Stat({ icon, label, value, sub, href, tone }: { icon: string; label: string; value: React.ReactNode; sub?: string; href?: string; tone?: string }) {
  const body = (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 4, height: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--color-ink-3)", fontWeight: 600 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone ?? "var(--color-ink)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 10.5 }}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href} style={{ textDecoration: "none", display: "block" }}>{body}</Link> : body;
}

// 需要/供給の小バケット
function Bucket({ icon, label, count, items, href, tone, muted }: { icon: string; label: string; count: number; items: string[]; href?: string; tone: string; muted?: string }) {
  return (
    <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{icon} {label}</span>
        {muted ? <span className="muted" style={{ fontSize: 10.5 }}>{muted}</span> : <span style={{ fontSize: 13, fontWeight: 800, color: tone }}>{count}</span>}
      </div>
      {!muted && items.length > 0 && (
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
          {items.slice(0, 4).map((t, i) => <li key={i} style={{ fontSize: 11.5, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>・{t}</li>)}
          {count > 4 && <li className="muted" style={{ fontSize: 10.5 }}>ほか {count - 4} 件{href ? "" : ""}</li>}
        </ul>
      )}
      {!muted && count === 0 && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>なし 👍</div>}
    </div>
  );
}

// 組織全体の集計データ（ユーザーに依存しない）。60秒キャッシュ＋タグで書込時に即時更新。
// ダッシュボードの体感速度を左右する重い6テーブル取得をここで一括キャッシュする。
const getDashboardData = unstable_cache(async () => {
  if (!dbConfigured) return { jobs: [], proposals: [], engs: [], cands: [], staff: [], meetings: [], setup: true };
  try {
    const sb = engerClient();
    const [J, P, E, C, S, M] = await Promise.all([
      grab(sb, "jobs", "job_no, title, client_name, is_focus, status, created_at, is_published, outside_owner", "job_no, title, client_name, created_at", 600),
      grab(sb, "proposals", "id, job_title, company, stage, proposer, partner, closer, rate, created_at, caller_status, meeting_date, meeting_status, disqualified, lost_reason", "id, job_title, company, stage, rate, created_at", 600),
      grab(sb, "engagements", "id, job_title, company, candidate_name, monthly_rate, start_date, end_date, status, cost, renewal_due, renewal_status", "id, job_title, company, monthly_rate, end_date, status", 400),
      grab(sb, "candidates", "id, initials, title, status, saved, rate_num, affiliation, start_date, last_contact_at", "id, initials, title, status, rate_num", 600),
      grab(sb, "staff", "name, position", "name", 200),
      grab(sb, "meetings", "id, company_name, our_owner, fb_sentiment, follow_up_date, follow_done, next_action_us", "id, company_name, our_owner, fb_sentiment", 400),
    ]);
    return { jobs: J.rows, proposals: P.rows, engs: E.rows, cands: C.rows, staff: S.rows, meetings: M.rows, setup: !J.ok && !P.ok };
  } catch { return { jobs: [], proposals: [], engs: [], cands: [], staff: [], meetings: [], setup: true }; }
}, ["agent-dashboard-data"], { revalidate: 60, tags: ["dashboard", "sidebar-counts"] });

export async function AgentDashboard({ role, myName, position }: { role: "admin" | "agent"; myName?: string | null; position?: "inside" | "outside" | null }) {
  const d = await getDashboardData();
  const jobs = d.jobs, engs = d.engs, cands = d.cands, staff = d.staff, meetings = d.meetings, setup = d.setup;
  let proposals = d.proposals; // 下で NG除外フィルタを再代入するため let

  // 当日の日報提出チェック（ユーザー依存・軽量なのでキャッシュ外。インデックス済みの単一行取得）
  let reportToday = false;
  if (dbConfigured && myName && !setup) {
    try { const sb = engerClient(); const dr = await sb.from("daily_reports").select("id").eq("author", myName).eq("report_date", new Date().toISOString().slice(0, 10)).maybeSingle(); reportToday = !!dr.data; } catch { /* 列なし等 */ }
  }

  // 当日のPR投稿チェック（運用者がX集客をやったか）。やっていなければアラート。
  let prToday = false;
  if (dbConfigured && myName && !setup) {
    try { const sb = engerClient(); const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0); const pr = await sb.from("pr_posts").select("id").eq("operator", myName).gte("created_at", todayStart.toISOString()).limit(1); prToday = !!(pr.data && pr.data.length); } catch { /* テーブル未作成等 */ }
  }

  // 区分（インサイド/アウトサイド）は廃止：全員が提案・クロージング・打合せを担当する。
  const jobByTitle = new Map(jobs.map((j) => [j.title, j]));

  // ===== 集計 =====
  // リード品質KPI（接触前失注・NG除外を母数から外す）は全提案で算出
  const kpi = leadKpi(proposals);
  // 以降のワークリスト/お金はNG除外を外して扱う
  proposals = proposals.filter((p) => !p.disqualified);

  const activeProps = proposals.filter((p) => ACTIVE_STAGES.includes(p.stage));
  const activeTitles = new Set(activeProps.map((p) => p.job_title).filter(Boolean));
  const pub = jobs.filter((j) => j.is_published !== false);
  const liveEngs = engs.filter((e) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");

  // --- 今日のアクション（締切のあるもの中心）---
  const today = todayStr();
  const hasMeetingDate = proposals.some((p) => p.meeting_date);
  const todaysMeetings = proposals.filter((p) => p.meeting_date === today);
  // 面談（新）＝旧 面談調整 を含む
  const meetingsAdjusting = proposals.filter((p) => p.stage === "面談" || p.stage === "面談調整");
  const renewSoon = liveEngs.filter((e) => { const d = daysUntil(e.end_date); return d != null && d <= 31 && d >= 0; });
  // 所属確認/提案中（提案直後・未反応）を架電フォロー対象に。旧 提案済/返信待ち も含める。
  const callPending = proposals.filter((p) => ["所属確認", "提案中", "提案済", "返信待ち"].includes(p.stage) || p.caller_status === "未架電");
  // 面談（合格手前）の長期滞留。旧 クロージング中 も含める。
  const closingStalled = proposals.filter((p) => (p.stage === "面談" || p.stage === "クロージング中") && daysAgo(p.created_at) >= 7);
  const actionTotal = (hasMeetingDate ? todaysMeetings.length : meetingsAdjusting.length) + renewSoon.length + callPending.length + closingStalled.length;

  // --- お金レーン ---
  const pipelineMan = activeProps.reduce((s, p) => s + rateToMan(p.rate), 0);
  const confirmedMan = liveEngs.reduce((s, e) => s + rateToMan(e.monthly_rate), 0);
  const hasCost = engs.some((e) => e.cost != null);
  const grossMan = hasCost ? liveEngs.reduce((s, e) => s + (rateToMan(e.monthly_rate) - rateToMan(e.cost)), 0) : null;

  // --- ファネル（案件→提案→面談→稼働）---
  const fProposed = proposals.length;
  const fMet = proposals.filter((p) => MET_STAGES.includes(p.stage)).length;
  const fActive = liveEngs.length;
  const funnel = [
    { k: "案件(公開)", n: pub.length },
    { k: "提案", n: fProposed },
    { k: "面談到達", n: fMet },
    { k: "稼働", n: fActive },
  ];
  const fMax = Math.max(1, ...funnel.map((f) => f.n));

  // --- 需要(案件側) ---
  const newJobs = pub.filter((j) => daysAgo(j.created_at) <= 7);
  const focusUntouched = pub.filter((j) => j.is_focus && !activeTitles.has(j.title));
  const staleJobs = pub.filter((j) => daysAgo(j.created_at) >= 14 && !activeTitles.has(j.title));
  const jLabel = (j: any) => `${j.title ?? "（無題）"}（${j.client_name ?? "—"}）`;

  // --- 供給(候補者側) ---
  const hasLastContact = cands.some((c) => c.last_contact_at);
  const hot = cands.filter((c) => (c.status ?? "").includes("提案") || c.saved);
  const lostTouch = hasLastContact ? cands.filter((c) => daysAgo(c.last_contact_at) >= 21) : [];
  const endingSoonPeople = liveEngs.filter((e) => { const d = daysUntil(e.end_date); return d != null && d <= 60 && d >= 0; });
  const cLabel = (c: any) => `${c.initials || c.title || "人材"}${c.affiliation ? `・${c.affiliation}` : ""}${c.rate_num ? `・¥${Math.round(c.rate_num)}万` : ""}`;
  const eLabel = (e: any) => `${e.candidate_name || "—"}（${e.company ?? "—"} / 満了まで${daysUntil(e.end_date)}日）`;

  // --- 担当者本人 ---
  const isMine = (p: any) => myName && (p.proposer === myName || p.closer === myName);
  const myActive = activeProps.filter(isMine);
  const myPipelineMan = myActive.reduce((s, p) => s + rateToMan(p.rate), 0);

  // ===== 区分別「今日の次の一手」 =====
  type Action = { icon: string; title: string; count: number; detail: string; href: string; items: string[] };
  const mineProposer = (p: any) => (myName ? p.proposer === myName : true);
  const hasOwnerData = jobs.some((j) => j.outside_owner);
  // 区分(インサイド/アウトサイド)撤廃：2人1組(提案者/パートナー/クロージング)のいずれかなら自分の担当
  const inPair = (p: any) => (myName ? (p.proposer === myName || p.partner === myName || p.closer === myName) : true);
  const mineOutside = inPair;

  // 新「返信待ち」=旧「提案中」（やり取り中・滞留している自分担当の案件）
  const insideStalled = proposals.filter((p) => (p.stage === "返信待ち" || p.stage === "提案中") && !isContacted(p) && daysAgo(p.created_at) >= 7 && mineProposer(p));
  const insideActions: Action[] = [
    { icon: "⭐", title: "注力案件を提案する", count: focusUntouched.length, detail: "注力なのに未提案。マッチングして提案", href: "/matching", items: focusUntouched.map(jLabel) },
    { icon: "🆕", title: "新着をマッチング", count: newJobs.filter((j: any) => !activeTitles.has(j.title)).length, detail: "7日以内の新着・未提案", href: "/matching", items: newJobs.filter((j: any) => !activeTitles.has(j.title)).map(jLabel) },
    { icon: "📞", title: "提案の初動", count: callPending.filter(mineProposer).length, detail: "自分の提案で返信待ち/未架電", href: "/proposals", items: callPending.filter(mineProposer).map((p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`) },
    { icon: "⏱", title: "停滞フォロー", count: insideStalled.length, detail: "提案中だが7日接触なし", href: "/proposals", items: insideStalled.map((p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`) },
  ];

  const myClosingStalled = closingStalled.filter(mineOutside);
  const myMeetings = (hasMeetingDate ? todaysMeetings : meetingsAdjusting).filter(mineOutside);
  const outsideEndDev = pub.filter((j) => (hasOwnerData && myName ? j.outside_owner === myName : true) && !activeTitles.has(j.title) && daysAgo(j.created_at) >= 14);
  // 打合せの要フォロー（期限到来 or ネガ反応・未完了）。自分が担当(our_owner)のもの
  const myFollows = meetings.filter((m) => {
    if (m.follow_done) return false;
    const due = m.follow_up_date && String(m.follow_up_date).slice(0, 10) <= today;
    const neg = (m.fb_sentiment ?? "").includes("ネガ");
    if (!due && !neg) return false;
    return myName ? m.our_owner === myName : true;
  });
  const outsideActions: Action[] = [
    { icon: "🔔", title: "打合せフォロー", count: myFollows.length, detail: "フォロー期限到来 / ネガ反応の対応", href: "/meetings", items: myFollows.map((m: any) => `${m.company_name ?? "—"}${m.next_action_us ? `：${m.next_action_us}` : ""}`) },
    { icon: "📅", title: hasMeetingDate ? "本日の面談・商談" : "面談調整を進める", count: myMeetings.length, detail: hasMeetingDate ? "本日予定の面談" : "面談調整中の案件", href: "/proposals", items: myMeetings.map((p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`) },
    { icon: "🤝", title: "クロージング", count: myClosingStalled.length, detail: "クロージング中で停滞", href: "/proposals", items: myClosingStalled.map((p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`) },
    { icon: "🔄", title: "契約更新の確認", count: renewSoon.length, detail: "30日以内に満了する稼働", href: "/progress", items: renewSoon.map((e: any) => `${e.candidate_name || "—"}（${e.company ?? "—"}）`) },
    { icon: "🏢", title: "エンド開拓・掘り起こし", count: outsideEndDev.length, detail: "担当案件で動きが止まっている", href: "/companies", items: outsideEndDev.map(jLabel) },
  ];

  // 区分撤廃：全員が「提案・面談・クロージング・打合せ」を担当する統合動線
  const actions: Action[] = [
    insideActions[0],   // 注力案件を提案する
    insideActions[1],   // 新着をマッチング
    insideActions[2],   // 提案の初動
    outsideActions[1],  // 面談（本日/調整）
    outsideActions[2],  // クロージング
    outsideActions[0],  // 打合せフォロー
    outsideActions[3],  // 契約更新の確認
  ].filter(Boolean);
  const actionsTotal = actions.reduce((s, a) => s + a.count, 0);

  // ===== 深掘りイシュー（カテゴリ別） =====
  const metRate = fProposed ? Math.round((fMet / fProposed) * 100) : 0;
  const lostRows = proposals.filter((p) => ["見送り", "失注"].includes(p.stage));
  const issueCategory = role === "admin" ? "管理者ビュー" : "営業ビュー";

  const agentIssues: Issue[] = [];
  if (fProposed >= 8 && metRate < 35) agentIssues.push({ id: "meet", sev: "high", title: "提案は出ているが面談に進んでいない", metric: `提案${fProposed}→面談${fMet}（${metRate}%）`, advice: "提案の質・初動フォローを見直し。返信待ちで接触できていない先を優先架電。", href: "/proposals", items: proposals.filter((p) => (p.stage === "返信待ち" || p.stage === "提案中") && !isContacted(p)).map((p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`) });
  if (callPending.length >= 3) agentIssues.push({ id: "call", sev: "mid", title: "初動（架電・返信）が滞っている", metric: `返信待ち/未架電 ${callPending.length}件`, advice: "当日中の初動が歩留まりを左右します。上から順に連絡。", href: "/proposals", items: callPending.map((p: any) => `${p.company ?? "—"}：${p.job_title ?? "—"}`) });
  if (staleJobs.length >= 5) agentIssues.push({ id: "stale", sev: "mid", title: "鮮度切れ案件が積み上がっている", metric: `14日以上・未提案 ${staleJobs.length}件`, advice: "古い案件はマッチングし直すか、クローズ判断を。", href: "/jobs", items: staleJobs.map(jLabel) });
  if (renewSoon.length >= 1) agentIssues.push({ id: "renew", sev: "high", title: "契約満了が近い稼働がある（売上防衛）", metric: `30日以内に満了 ${renewSoon.length}名`, advice: "更新交渉を前倒し。終了予定なら後任の手配を。", href: "/progress", items: renewSoon.map((e: any) => `${e.candidate_name || "—"}（${e.company ?? "—"} / 満了まで${daysUntil(e.end_date)}日）`) });
  if (agentIssues.length === 0) agentIssues.push({ id: "ok", sev: "good", title: "大きなボトルネックはありません", metric: `面談化 ${metRate}% / 進行中 ${activeProps.length}件`, advice: "在庫から次の仕込み（注力案件の提案・新規開拓）を進めましょう。" });

  // 管理者：組織レベルの課題
  const adminIssues: Issue[] = [];
  if (lostRows.length >= 5) {
    const rc: Record<string, number> = {}; for (const p of lostRows) { const k = p.lost_reason || "（理由未入力）"; rc[k] = (rc[k] ?? 0) + 1; }
    const top = Object.entries(rc).sort((a, b) => b[1] - a[1]); const share = Math.round((top[0][1] / lostRows.length) * 100);
    adminIssues.push({ id: "lost", sev: share >= 40 ? "high" : "mid", title: "失注が特定要因に偏っている", metric: `${top[0][0]} が${share}%（失注${lostRows.length}件）`, advice: "最多要因に的を絞った打ち手（単価・スピード・要件詰め）を。", href: "/analytics", hrefLabel: "失注分析へ", items: top.slice(0, 6).map(([r, n]) => `${r}：${n}件`) });
  }
  const jcov = pub.length ? Math.round((pub.filter((j) => j.skills?.length).length / pub.length) * 100) : 100;
  const ccov = cands.length ? Math.round((cands.filter((c) => c.skills?.length).length / cands.length) * 100) : 100;
  if (jcov < 70 || ccov < 70) adminIssues.push({ id: "cov", sev: "mid", title: "重要データの充足が不足（仮説の信頼性低下）", metric: `案件スキル ${jcov}% / 人材スキル ${ccov}%`, advice: "取込ゲートで『完備のみ取込』を徹底。未入力の補完を依頼。", href: "/analytics", hrefLabel: "充足を確認" });
  const renewYen = renewSoon.reduce((s: number, e: any) => s + rateToMan(e.monthly_rate), 0);
  if (renewYen > 0) adminIssues.push({ id: "renewyen", sev: "high", title: "更新リスクのある売上がある", metric: `30日以内に満了 ${renewSoon.length}名 / 月額${yen(renewYen)}`, advice: "更新確度を担当に確認。終了予定は早期に後任提案を。", href: "/progress", hrefLabel: "稼働管理へ" });
  if (fProposed >= 10 && metRate < 30) adminIssues.push({ id: "funnel", sev: "mid", title: "全体の面談到達率が低い", metric: `提案→面談 ${metRate}%`, advice: "提案の質（マッチ精度）と初動プロセスを組織で標準化。", href: "/analytics", hrefLabel: "ファネルを見る" });
  if (adminIssues.length === 0) adminIssues.push({ id: "okadmin", sev: "good", title: "組織レベルの重大な課題はありません", metric: `面談化 ${metRate}% / 失注 ${lostRows.length}件`, advice: "担当者別の動き（分析）で個別の伸びしろを確認しましょう。", href: "/analytics", hrefLabel: "担当者別分析へ" });

  const issues = role === "admin" ? adminIssues : agentIssues;

  // ===== KPI（区分別）・チーム/クロージング =====
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const myProposalsMonth = proposals.filter((p) => p.proposer === myName && String(p.created_at ?? "").slice(0, 7) === monthPrefix).length;
  const myMeetingsWeek = meetings.filter((m) => m.our_owner === myName && String(m.meeting_date ?? "").slice(0, 10) >= weekAgo).length;
  const KPI_PROPOSAL = 20, KPI_MEETING = 3;

  // 2人1組（提案者＋パートナー）でクロージングまで。期限1週間。区分は問わない。
  const CLOSING_STAGES = ["合格", "面談", "面談合格", "クロージング中"];
  const mineInTeam = (p: any) => (myName ? (p.proposer === myName || p.partner === myName || p.closer === myName) : true);
  const closingTeam = proposals.filter((p) => CLOSING_STAGES.includes(p.stage) && mineInTeam(p)).map((p: any) => {
    const d = daysAgo(p.created_at);
    return { p, inside: p.proposer || "—", outside: p.partner || "—", closer: p.closer || "未定", days: d, overdue: d >= 7, hasReason: !!(p.next_action || p.lost_reason) };
  }).sort((a, b) => b.days - a.days);
  // ペア未成立：進行中だがパートナー未割当
  const teamMissing = activeProps.filter((p) => p.proposer && !p.partner);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Dashboard · {role === "admin" ? "管理者" : "エージェント"}</div>
          <h1>{role === "admin" ? "経営ダッシュボード" : <>今日のアクション{actionTotal > 0 ? <span style={{ color: "var(--color-brand-600)" }}> {actionTotal}件</span> : ""}</>}</h1>
          <div className="sub">{role === "admin"
            ? "組織の課題（深掘りイシュー）と売上見込みを把握し、担当者別の動きから改善に手を打ちます。"
            : "締切のある対応を上段で、需要（案件）と供給（人材）を両輪で。効率よくマッチして売上を伸ばしましょう。"}</div>
        </div>
      </div>

      {/* 管理者の確認導線 */}
      {role === "admin" && !setup && (
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>🧭 管理メニュー：</span>
          <Link href="/analytics" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>分析・担当者別の動き</Link>
          <Link href="/pipeline" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>売上フォーキャスト</Link>
          <Link href="/reports" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>日報フィードバック</Link>
          <Link href="/settings" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>品質ルール・権限</Link>
        </div>
      )}

      {setup && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          案件・提案テーブルが未作成、またはデータがありません。<span className="mono">supabase/schema-matching.sql</span> 実行後に実データが表示されます。
        </div>
      )}

      {/* ① 日報リマインダー（提出する役職の人に表示。管理者/マネージャーも自分の日報を書けるよう対象に含める） */}
      {myName && !reportToday && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#fff5e6", border: "1px solid #f6d9a7" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#b45309" }}>📝 今日の日報がまだ未提出です。1日の振り返りを記録しましょう。</span>
          <Link href="/reports" className="btn brand btn-xs" style={{ textDecoration: "none" }}>日報を書く →</Link>
        </div>
      )}

      {/* 📣 今日のPRリマインダー（運用者がX集客を忘れないように。本人がまだ投稿していなければ表示） */}
      {myName && !prToday && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "#eef6ff", border: "1px solid #bcdcff" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0b5cab" }}>📣 今日のPR投稿（X集客）がまだです。登録者を増やすため1日1回の発信を。</span>
          <Link href="/pr" className="btn brand btn-xs" style={{ textDecoration: "none" }}>XでPRする →</Link>
        </div>
      )}

      {/* 🎯「今日の次の一手」（ヒーロー）※ 個人向け。管理者は経営ボードを見るため非表示。区分問わず提案・面談・クロージング・打合せを担当 */}
      {role !== "admin" && !setup && (
        <div className="card" style={{ borderColor: "var(--color-brand-200, var(--color-brand-100))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>🎯 あなたの次の一手</h3>
            </div>
            <span className="muted" style={{ fontSize: 11 }}>提案・面談・クロージング・打合せ · 上から順に対応</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            {actions.map((a, i) => (
              <Link key={i} href={a.href} style={{ textDecoration: "none" }}>
                <div className="card" style={{ padding: 14, height: "100%", display: "flex", flexDirection: "column", gap: 6, opacity: a.count === 0 ? 0.55 : 1, borderColor: a.count > 0 ? "var(--color-brand-100)" : "var(--color-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{a.icon} {a.title}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: a.count > 0 ? "var(--color-brand-700,#0b5cab)" : "var(--color-ink-4)" }}>{a.count}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{a.detail}</div>
                  {a.count > 0 && (
                    <ul style={{ margin: "2px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                      {a.items.slice(0, 3).map((t, k) => <li key={k} style={{ fontSize: 11, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>・{t}</li>)}
                    </ul>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {actionsTotal === 0 && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>今すぐ対応すべきものはありません 👍 在庫から次の仕込みを進めましょう。</div>}
        </div>
      )}

      {/* ② あなたのKPI ※ 個人向け。管理者は非表示。区分問わず提案・打合せ両方を計測 */}
      {role !== "admin" && !setup && myName && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🎯 あなたのKPI</h3>
            <span className="muted" style={{ fontSize: 11 }}>提案・打合せの両方を計測</span>
          </div>
          <div className="kpi-grid">
            {(() => { const v = myProposalsMonth, t = KPI_PROPOSAL, ok = v >= t; return (
              <div className="kpi" style={{ borderColor: "var(--color-brand-300, var(--color-brand-100))" }}><div>
                <div className="val tnum" style={{ color: ok ? "#067647" : "var(--color-ink)" }}>{v}<span className="unit">/{t}</span></div>
                <div className="label">提案（今月）</div>
                <div style={{ height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", marginTop: 6 }}><div style={{ width: `${Math.min(100, (v / t) * 100)}%`, height: "100%", background: ok ? "#1aa260" : "var(--color-brand-600)" }} /></div>
                <div className="note">{ok ? "達成 🎉" : `あと ${t - v} 件`}</div>
              </div></div>); })()}
            {(() => { const v = myMeetingsWeek, t = KPI_MEETING, ok = v >= t; return (
              <div className="kpi" style={{ borderColor: "var(--color-brand-300, var(--color-brand-100))" }}><div>
                <div className="val tnum" style={{ color: ok ? "#067647" : "var(--color-ink)" }}>{v}<span className="unit">/{t}</span></div>
                <div className="label">打合せ（今週）</div>
                <div style={{ height: 5, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden", marginTop: 6 }}><div style={{ width: `${Math.min(100, (v / t) * 100)}%`, height: "100%", background: ok ? "#1aa260" : "var(--color-brand-600)" }} /></div>
                <div className="note">{ok ? "達成 🎉" : `あと ${t - v} 件`}</div>
              </div></div>); })()}
            <div className="kpi accent"><div><div className="val tnum">{closingTeam.length}<span className="unit">件</span></div><div className="label">担当ペアのクロージング</div><div className="note">{closingTeam.filter((c) => c.overdue).length} 件が期限超過</div></div></div>
            <div className="kpi warn"><div><div className="val tnum">{teamMissing.length}<span className="unit">件</span></div><div className="label">ペア未成立</div><div className="note">パートナー未割当</div></div></div>
          </div>
        </div>
      )}

      {/* ③④ クロージング・チーム（2人1組・1週間で決着） */}
      {!setup && (closingTeam.length > 0 || teamMissing.length > 0) && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🤝 クロージング・ペア</h3>
            <span className="muted" style={{ fontSize: 11 }}>提案者＋パートナーの2人1組で、1週間以内に決着（延長は理由を記載）</span>
          </div>
          {closingTeam.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {closingTeam.slice(0, 8).map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", border: "1px solid var(--color-border)", borderRadius: 10, background: c.overdue ? "#fdecef" : "var(--color-surface)" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.p.company ?? "—"}：{c.p.job_title ?? "—"}</span>
                  <span className="tag" style={{ fontSize: 10 }}>提案 {c.inside}</span>
                  <span className="tag" style={{ fontSize: 10 }}>組 {c.outside}</span>
                  <span className="tag" style={{ fontSize: 10, background: "#e7f7ee", color: "#067647" }}>CL {c.closer}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: c.overdue ? "#b42318" : "#b45309", whiteSpace: "nowrap" }}>{c.overdue ? `期限超過(${c.days}日)` : `あと${Math.max(0, 7 - c.days)}日`}</span>
                  {c.overdue && (c.hasReason ? <span style={{ fontSize: 10, color: "#067647" }}>延長理由あり</span> : <span style={{ fontSize: 10, color: "#b42318" }}>要・延長理由</span>)}
                </div>
              ))}
            </div>
          )}
          {teamMissing.length > 0 && (
            <div style={{ marginTop: 10, background: "#fff5e6", border: "1px solid #f6d9a7", borderRadius: 10, padding: "9px 12px", fontSize: 12.5 }}>
              ⚠️ <b>ペア未成立 {teamMissing.length}件</b>：提案済みだがパートナーが未割当です。<Link href="/proposals" style={{ color: "var(--color-brand-700,#0b5cab)", fontWeight: 700 }}>提案管理でパートナーを設定 →</Link>
            </div>
          )}
        </div>
      )}

      {/* 深掘りイシュー（カテゴリ別） */}
      {!setup && <IssueBoard title="深掘りイシュー" category={issueCategory} issues={issues} />}

      {/* お金レーン（重要KPI・常時表示） */}
      <div className="kpi-grid">
        <div className="kpi brand"><div><div className="val tnum">{yen(pipelineMan)}</div><div className="label">見込み（進行中の月額）</div><div className="note">{activeProps.length} 件の提案</div></div></div>
        <div className="kpi accent"><div><div className="val tnum">{yen(confirmedMan)}</div><div className="label">確定（稼働中の月額）</div><div className="note">{liveEngs.length} 名 稼働</div></div></div>
        <div className="kpi"><div><div className="val tnum">{grossMan == null ? "—" : yen(grossMan)}</div><div className="label">粗利（月額）</div><div className="note">{grossMan == null ? "原価データ未設定" : "売上−原価"}</div></div></div>
        <div className="kpi warn"><div><div className="val tnum">{fProposed ? Math.round((fMet / fProposed) * 100) : 0}<span className="unit">%</span></div><div className="label">面談到達率</div><div className="note">接触後失注 {kpi.postLostRate}%</div></div></div>
      </div>

      {/* 詳細指標は折りたたみ（既定は非表示でシンプルに） */}
      {!setup && (
      <Collapsible label="詳細指標を表示（AIブリーフィング・リード品質・両輪・契約更新・ファネル）">
        <DailyBriefing metrics={{
          meetings: hasMeetingDate ? todaysMeetings.length : meetingsAdjusting.length,
          renewSoon: renewSoon.length, callPending: callPending.length, closingStalled: closingStalled.length,
          focusUntouched: focusUntouched.length, staleJobs: staleJobs.length, newJobs: newJobs.length,
          hot: hot.length, endingSoon: endingSoonPeople.length,
          pipelineMan, confirmedMan, fJobs: pub.length, fProposed, fMet, fActive,
        }} />

      {/* リード品質（母数の整流：接触前失注・NGを除外） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🚦 リード品質（接触後で評価）</h3>
          <span className="muted" style={{ fontSize: 11 }}>母数は有効リード。件数より歩留まり重視</span>
        </div>
        <div className="kpi-grid">
          <Stat icon="✅" label="有効リード" value={kpi.valid} sub={`全${kpi.total}件 − 接触前失注 − NG`} tone="#0b5cab" />
          <Stat icon="🚫" label="接触前失注（母数外）" value={kpi.preLost} sub="そもそも有効でないリード" tone="#6b7280" />
          <Stat icon="🛑" label="NG除外" value={kpi.ngExcluded} sub="品質ルールで除外（設定）" tone="#b45309" />
          <Stat icon="📉" label="接触後失注率" value={<>{kpi.postLostRate}<span style={{ fontSize: 13 }}>%</span></>} sub={`接触後失注 ${kpi.postLost}件 / 有効${kpi.valid}`} tone="#b42318" />
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>※ NG指定・しきい値は 設定 → 品質ルール で調整できます（接触前失注は自動で母数外）。</div>
      </div>

      {/* ② 両輪：需要（案件）⇔ 供給（人材） */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap, 20px)" }} className="duo-grid">
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📁 案件側（需要）</h3>
            <Link href="/jobs" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>案件一覧 →</Link>
          </div>
          <Bucket icon="⭐" label="注力・未提案" count={focusUntouched.length} items={focusUntouched.map(jLabel)} tone="#b45309" />
          <Bucket icon="🌥" label="鮮度切れ（14日+・提案なし）" count={staleJobs.length} items={staleJobs.map(jLabel)} tone="#6b7280" />
          <Bucket icon="📦" label="新着在庫（参照のみ）" count={newJobs.length} items={[]} tone="var(--color-ink-3)" muted={`${newJobs.length} 件 · 7日以内`} />
        </div>

        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🧑‍💻 候補者側（供給）</h3>
            <Link href="/people" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>人材一覧 →</Link>
          </div>
          <Bucket icon="🔥" label="ホット（即動ける）" count={hot.length} items={hot.map(cLabel)} tone="#067647" />
          <Bucket icon="⏳" label="満了間近・再提案候補（60日内）" count={endingSoonPeople.length} items={endingSoonPeople.map(eLabel)} tone="#0b5cab" />
          <Bucket icon="📵" label="連絡途絶（21日+）" count={lostTouch.length} items={lostTouch.map(cLabel)} tone="#b42318" muted={hasLastContact ? undefined : "最終接触日が必要（agent-ops.sql）"} />
        </div>
      </div>

      {/* ③ 契約更新アラート（既存売上の防衛線） */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🛡 契約更新アラート（既存売上の防衛線）</h3>
          <Link href="/progress" style={{ fontSize: 12, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>稼働管理 →</Link>
        </div>
        <div className="kpi-grid">
          <Stat icon="📆" label="来月満了" value={`${renewSoon.length} 名`} sub="30日以内に契約満了" tone="#b45309" />
          <Stat icon="⏰" label="回答期限切れ間近" value={engs.some((e) => e.renewal_due) ? `${engs.filter((e) => { const d = daysUntil(e.renewal_due); return d != null && d <= 7 && d >= 0; }).length} 件` : "—"} sub={engs.some((e) => e.renewal_due) ? "更新回答の期限7日内" : "更新期限データ未設定"} tone="#b42318" />
          <Stat icon="📉" label="ドロップ予兆" value={engs.some((e) => e.renewal_status) ? `${engs.filter((e) => e.renewal_status === "終了予定").length} 件` : "—"} sub={engs.some((e) => e.renewal_status) ? "更新意向=終了予定" : "更新意向データ未設定"} tone="#6b7280" />
        </div>
        {renewSoon.length > 0 && (
          <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
            {renewSoon.slice(0, 6).map((e, i) => (
              <li key={i} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--color-border)", paddingBottom: 5 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.candidate_name || "—"} ・ {e.company ?? "—"}</span>
                <span className="mono" style={{ color: "#b45309", flexShrink: 0 }}>満了まで {daysUntil(e.end_date)}日</span>
              </li>
            ))}
          </ul>
        )}
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
              <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-inset)", overflow: "hidden" }}>
                <div style={{ width: `${(f.n / fMax) * 100}%`, height: "100%", background: "var(--color-brand-600)", borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 担当者本人 */}
      {myName && myActive.length > 0 && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>👤 {myName} さんの担当</div>
            <div style={{ fontSize: 13 }}>進行中 <b>{myActive.length}</b> 件</div>
            <div style={{ fontSize: 13 }}>見込み <b>{yen(myPipelineMan)}</b></div>
            <Link href="/proposals" className="btn brand btn-xs" style={{ marginLeft: "auto", textDecoration: "none" }}>提案管理へ</Link>
          </div>
        </div>
      )}
      </Collapsible>
      )}
    </div>
  );
}
