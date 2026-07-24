import Link from "@/components/AppLink";
import { Icons } from "@/components/icons";
import { FocusHeart } from "@/components/FocusHeart";
import { ProposalComposer } from "@/components/ProposalComposer";
import { MatchChecklist } from "@/components/MatchChecklist";
import { RankList } from "@/components/RankList";
import { RankJobList } from "@/components/RankJobList";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ShareExternalButton } from "@/components/ShareExternalButton";
import { FocusList } from "@/components/FocusList";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { rankCandidates, rankJobs, jobOpenness, scoreMatch, JOB_STALE_DAYS, type Job, type MatchResult, type Verdict } from "@/lib/match";
import { getHiddenPairsSet, hiddenPairKey } from "@/lib/hidden-pairs";
import { relatedSearchLabels } from "@/lib/skills";
import { FLOW_LABEL, FLOW_TONE, displayFlowNote } from "@/lib/flow";
import { getBouncedSet, type BounceRecord } from "@/lib/bounces";
import { getLineOriginIds, getFreelanceCandidateIds } from "@/lib/line-origin";
import { getViewerScope, maskJobs, maskCandidates } from "@/lib/tenant";
import { gmailConfigured } from "@/lib/gmail-api";
import { PartnerMatching } from "@/components/PartnerMatching";
import { ConfirmJobButton } from "@/components/ConfirmJobButton";
import { MatchingPeerTabs } from "@/components/MatchingTabs";
import { MatchingModeTabs } from "@/components/MatchingModeTabs";
import { Ranking100View } from "@/components/Ranking100View";
import { getSidebarCounts } from "@/lib/counts";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getStaff } from "@/lib/staff";
import { loadMatchWindow, withinWindow } from "@/lib/match-window";
import { asClientPeriod, inClientPeriod, inCustomRange, hasCustomRange, monthToRange } from "@/lib/period";
import { MatchingPeriodChips } from "@/components/MatchingPeriodChips";
import { MatchingAssigneePicker } from "@/components/MatchingAssigneePicker";
import { classifyCandNationality, CAND_NAT_LABEL, CAND_NAT_TONE, classifyJobNationality, JOB_NAT_LABEL, classifyJobAge } from "@/lib/nationality";
import { attachLatestSourceMail } from "@/lib/source-mail";
import { listLineworksTargets } from "@/lib/lineworks-targets";
import { QuickAccessButtons } from "@/components/QuickAccessButtons";

export const dynamic = "force-dynamic";

// 案件側の勤務形態ラベル（案件は条件＝onsite は「出社必須」）。
const remoteLabel = (r: string | null | undefined) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "—");
// 人材側の勤務希望ラベル（人材は希望＝onsite は「出社可」。案件の「出社必須」と区別する）。
//   enum 値に加え、自由文（"一部リモート可" など）も「希望」表記に正規化する。
const candRemoteLabel = (r: string | null | undefined) => {
  const s = (r ?? "").trim();
  if (!s) return "—";
  if (s === "full_remote") return "フルリモート希望";
  if (s === "partial_remote") return "一部リモート希望";
  if (s === "onsite") return "出社可";
  if (/フル|完全/.test(s) && /リモート|在宅/.test(s)) return "フルリモート希望";
  if (/リモート|在宅/.test(s)) return "一部リモート希望"; // 「一部リモート可」等も希望表記へ
  if (/出社|常駐/.test(s)) return "出社可";
  return s;
};
const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";

// 取込時に付与される「[削除スキル: …]」タグ＋以降の営業定型文は表示に不要なので落とす。
//   ※ AI 評価には元の detail をそのまま渡す（除去するのは人が読む表示のみ）。
const cleanDetail = (s: string | null | undefined): string | null => {
  if (!s) return s ?? null;
  const i = s.search(/\[?\s*削除スキル[:：]/);
  return (i >= 0 ? s.slice(0, i) : s).trim() || null;
};

const ageDays = (d: any) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 9999);

const verdictStyle = (v: Verdict): { bg: string; fg: string; bd: string } => {
  if (v === "提案推奨") return { bg: "#e7f3ea", fg: "#067647", bd: "#bfe3cc" };
  if (v === "条件付き提案推奨") return { bg: "#fff6e0", fg: "#9a7b12", bd: "#fde9b0" };
  if (v === "条件付き提案検討") return { bg: "#fef0c7", fg: "#b45309", bd: "#fcd97a" };
  return { bg: "#fdecef", fg: "#b42318", bd: "#f7c5cf" };
};

/** マッチ理由を 🔴重要 / 🟡注意 / 🟢参考 の3段階で表示。 */
function NotesPanel({ sel }: { sel: MatchResult }) {
  const red = sel.notes.filter((n: { level: string }) => n.level === "red");
  const yel = sel.notes.filter((n: { level: string }) => n.level === "yellow");
  const grn = sel.notes.filter((n) => n.level === "green");
  const Bar = ({ label, color, score, max }: { label: string; color: string; score: number; max: number }) => (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(64px,90px) 1fr 56px", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, color: "var(--color-ink-3)" }}>{label}</span>
      <div style={{ height: 6, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 99 }} />
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-3)", textAlign: "right" }}>{Math.round(score)}/{max}</span>
    </div>
  );
  const b = sel.breakdown;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--color-ink-4)" }}>📊 内訳</div>
        <Bar label="スキル" color="#0095D9" score={b.skill * 0.8} max={80} />
        <Bar label="単価" color="#1aa260" score={b.salary * 0.08} max={8} />
        <Bar label="勤務形態" color="#0F2440" score={b.remote * 0.05} max={5} />
        <Bar label="稼働時期" color="#9a7b12" score={b.timing * 0.04} max={4} />
        <Bar label="年齢" color="#7c3aed" score={b.age * 0.03} max={3} />
        {b.bonus > 0 && <div style={{ fontSize: 11, color: "#067647" }}>＋ ボーナス {b.bonus}（PP/マージン/業界経験）</div>}
      </div>
      {red.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#b42318", marginBottom: 3 }}>🔴 重要</div>
          {red.map((n, i) => <div key={i} style={{ fontSize: 12, color: "#b42318", lineHeight: 1.6 }}>{n.text}</div>)}
        </div>
      )}
      {yel.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#b45309", marginBottom: 3 }}>🟡 注意</div>
          {yel.map((n, i) => <div key={i} style={{ fontSize: 12, color: "#9a7b12", lineHeight: 1.6 }}>{n.text}</div>)}
        </div>
      )}
      {grn.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#067647", marginBottom: 3 }}>🟢 参考</div>
          {grn.map((n, i) => <div key={i} style={{ fontSize: 12, color: "#067647", lineHeight: 1.6 }}>{n.text}</div>)}
        </div>
      )}
      {red.length + yel.length + grn.length === 0 && <span className="muted" style={{ fontSize: 12 }}>—</span>}
    </div>
  );
}
const isProper = (a: any) => /\bPP\b|プロパー|自社/i.test(String(a || ""));

/**
 * 注力マッチングの対象を選定（定義）：
 *   ① ♡お気に入り(is_focus)  ② プロパー(PP)  ③ 最近(30日内)登録 かつ 決まりやすい(スキル有 or 提案可)
 *   注力スコアで並べ、上限60件に絞る（母数=300のような無意味な数を避ける）。
 */
function curateFocus(kind: "jobs" | "cands", rows: any[]): any[] {
  const seen = new Set<number>(); const out: any[] = [];
  for (const r of rows) {
    // ゴミ箱に入っているレコードはマッチング対象から除外（未マイグレ環境では undefined のまま通る）
    if (r?.deleted_at) continue;
    const id = kind === "jobs" ? r.job_no : r.candidate_no;
    if (id == null || seen.has(id)) continue;
    const d = ageDays(r.created_at);
    const likely = !!(r.skills?.length) || String(r.status || "").includes("提案");
    const pp = kind === "cands" && isProper(r.affiliation);
    const qualifies = !!r.is_focus || pp || (d <= 30 && likely);
    if (!qualifies) continue;
    seen.add(id);
    let s = 0; const why: string[] = [];
    if (r.is_focus) { s += 100; why.push("♡注力"); }
    if (pp) { s += 50; why.push("プロパー"); }
    if (d <= 7) { s += 30; why.push("新着"); } else if (d <= 30) { s += 15; why.push("最近登録"); }
    if (String(r.status || "").includes("提案")) s += 10;
    if (r.skills?.length) s += 10;
    out.push({ ...r, _focusScore: s, _focusWhy: why.slice(0, 2) });
  }
  return out.sort((a, b) => b._focusScore - a._focusScore || ageDays(a.created_at) - ageDays(b.created_at)).slice(0, 60);
}

function Stars({ score }: { score: number }) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return (
    <span style={{ color: "#f0a92b", letterSpacing: 1, fontSize: 13 }}>
      {"★".repeat(n)}<span style={{ color: "var(--color-ink-5)" }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

/**
 * 企業マスタ (enger.companies) の contact_name / contact_email を、対象アイテムへ後付けする。
 *   items: 案件 or 候補者の配列
 *   companyKey: 突合キー（案件は "client_name"、候補者は "source_company"）
 * 既に contact_name / contact_email が入っているアイテムは上書きしない。
 */
async function attachCompanyContact(sb: any, items: any[], companyKey: "client_name" | "source_company") {
  if (!items || items.length === 0) return;
  const names = Array.from(new Set(items.map((it) => it?.[companyKey]).filter(Boolean))) as string[];
  if (names.length === 0) return;
  try {
    const r: any = await sb.from("companies").select("name, contact_name, contact_email").in("name", names).limit(2000);
    if (r.error || !Array.isArray(r.data)) return;
    const cnMap: Record<string, string> = {};
    const ceMap: Record<string, string> = {};
    for (const c of r.data) {
      if (c.name && c.contact_name && !cnMap[c.name]) cnMap[c.name] = c.contact_name;
      if (c.name && c.contact_email && !ceMap[c.name]) ceMap[c.name] = c.contact_email;
    }
    for (const it of items) {
      const k = it?.[companyKey];
      if (!k) continue;
      if (!it.contact_name && cnMap[k]) it.contact_name = cnMap[k];
      if (!it.contact_email && ceMap[k]) it.contact_email = ceMap[k];
      // 企業マスタの窓口メールは別フィールドにも保持（CC自動反映で案件窓口と併せて使う）。
      if (ceMap[k]) it.company_contact_email = ceMap[k];
    }
  } catch { /* noop */ }
}

/** パートナー企業向け：自社(owner_company)＋共有(shared)のみ取得して匿名化。
 *  既存マッチング画面のクエリは内部メールアドレス等を多数返すため、パートナーは別ビューで分離。 */
async function loadTenantData(company: string, meetingDone: boolean = true) {
  const sb = engerClient();
  const J = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, work_location, start_date, is_published, owner_company, shared";
  const C = "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, skills, salary_min, salary_max, remote_pref, status, exp, rate, avail, location, residence, owner_company, shared";
  const fetchJobs = async () => {
    const o: any = await sb.from("jobs").select(J).eq("owner_company", company).order("job_no", { ascending: false }).limit(500);
    const s: any = await sb.from("jobs").select(J).eq("shared", true).eq("is_published", true).order("job_no", { ascending: false }).limit(500);
    if (o.error || s.error) return null;
    const map = new Map<number, any>();
    for (const r of [...(o.data ?? []), ...(s.data ?? [])]) if (r.job_no != null && (r.owner_company === company || r.shared === true)) map.set(r.job_no, r);
    return [...map.values()];
  };
  const fetchCands = async () => {
    const o: any = await sb.from("candidates").select(C).eq("owner_company", company).order("candidate_no", { ascending: false }).limit(500);
    const s: any = await sb.from("candidates").select(C).eq("shared", true).order("candidate_no", { ascending: false }).limit(500);
    if (o.error || s.error) return null;
    const map = new Map<number, any>();
    for (const r of [...(o.data ?? []), ...(s.data ?? [])]) if (r.candidate_no != null && (r.owner_company === company || r.shared === true)) map.set(r.candidate_no, r);
    return [...map.values()];
  };
  const [jobs, cands] = await Promise.all([fetchJobs(), fetchCands()]);
  return { jobs: jobs ? maskJobs(jobs, company, meetingDone) : null, cands: cands ? maskCandidates(cands, company, meetingDone) : null };
}

export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ job?: string; tab?: string; cand?: string; person?: string; stale?: string; period?: string; from?: string; to?: string; assignee?: string }> }) {
  const sp = await searchParams;
  // 古い案件（配信から JOB_STALE_DAYS 超）/ 期間外を含めて表示するか。既定は false（隠す）。
  const showStale = sp.stale === "1";
  // 期間セレクタ（統一デザイン）。登録日(created_at)でマッチング対象を絞り込む。
  //   既定は「当月」（要望：全期間ではなく、今が7月なら7月をデフォルト表示）。
  //   URLに period も from/to も無い初回アクセス時だけ当月レンジを既定として適用する。
  //   「全期間」を明示選択（?period=all）した場合は従来どおり全期間（no-op）にする。
  const nowD = new Date();
  const bareVisit = !sp.period && !hasCustomRange(sp.from, sp.to);
  const defMonth = monthToRange(nowD.getFullYear(), nowD.getMonth() + 1);
  const effFrom = bareVisit ? defMonth.from : sp.from;
  const effTo = bareVisit ? defMonth.to : sp.to;
  const mPeriod = asClientPeriod(sp.period, "all");
  const mCustom = hasCustomRange(effFrom, effTo);
  const periodActive = mCustom || mPeriod !== "all";
  const inMPeriod = (createdAt: string | null | undefined) =>
    mCustom ? inCustomRange(createdAt, effFrom, effTo) : inClientPeriod(createdAt, mPeriod);
  // 特定の人材/案件を明示選択したドリルダウン（一覧の「マッチング」ボタンからの遷移）。
  //   この場合は相手側を鮮度ウィンドウ・注力フラグで絞らず、全件から上位をランキング表示する。
  //   （鮮度ガード/注力は「束ねて探す」用途＝おすすめTOP50・注力ボード・一覧に限定する。
  //    明示的に1件を選んだのに相手が0件、という事故を防ぐ。）
  const drillDown = !!sp.person || !!sp.job;
  // マッチング対象期間（鮮度ウィンドウ）。取込日が直近 days 日以内のみ対象。showStale=1 で期間外も表示。
  const matchWindow = await loadMatchWindow();
  const windowActive = matchWindow.enabled && !showStale && !drillDown;
  const windowNow = Date.now();
  const inWindow = (createdAt: string | null | undefined) => !windowActive || withinWindow(createdAt, matchWindow.days, windowNow);
  // 関連タブのカウント（マッチング/案件/人材/LP登録）。ヘッダーから本体に移したため
  // ページ側で取得して MatchingPeerTabs に渡す。
  const peerCounts = await getSidebarCounts();
  // 提案ボタン押下時の「提案者／承認者」プルダウンの選択肢。manual list（admin編集）優先、無ければ社内メンバーの自動リスト。
  const [proposalOwners, staffData] = await Promise.all([loadProposalOwners(), getStaff()]);
  const proposerMembers: string[] = (proposalOwners?.proposers && proposalOwners.proposers.length > 0)
    ? proposalOwners.proposers
    : staffData.members;
  // パートナー企業はテナント隔離のため別画面（自社＋共有のみ・他社匿名・提案/メール無効）
  const scope = await getViewerScope();
  if (scope.isTenant) {
    if (!scope.ownerKey) {
      return <div className="page"><div className="card" style={{ color: "var(--color-danger)" }}>会社情報が未設定です。管理者にお問い合わせください。</div></div>;
    }
    if (!dbConfigured) {
      return <div className="page"><div className="card" style={{ color: "var(--color-danger)" }}>DB未接続のためマッチングを利用できません。</div></div>;
    }
    const data = await loadTenantData(scope.ownerKey, scope.meetingDone);
    if (!data.jobs || !data.cands) {
      return <div className="page"><div className="card" style={{ color: "var(--color-danger)" }}>テナント分離用の列が未整備です（supabase/partner-tenant.sql を実行してください）。安全のため一覧を表示しません。</div></div>;
    }
    return (
      <div className="page">
        <div className="page-head"><div><div className="meta">Matching · 自分×共有</div><h1>マッチング</h1></div></div>
        <PartnerMatching jobs={data.jobs} candidates={data.cands} />
      </div>
    );
  }
  // ランキング100：必須スキル一致率75%以上の案件×人材ペアを上位100件表示する専用タブ。
  if (sp.tab === "ranking") {
    const { getRanking100 } = await import("@/lib/ranking100");
    const { Ranking100View } = await import("@/components/Ranking100View");
    const data = await getRanking100();
    return (
      <div className="page">
        <MatchingPeerTabs counts={peerCounts} />
        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Matching · ランキング100</div>
            <h1>マッチングランキング</h1>
            <div className="sub">全案件 × 全人材から<b>必須スキル一致率 75%以上</b>のペアを抽出し、一致率順に上位100件を表示します。</div>
          </div>
        </div>
        <MatchingModeTabs />
        <Ranking100View rows={data.rows} meta={{ jobsScanned: data.jobsScanned, candsScanned: data.candsScanned, pairsHit: data.pairsHit }} />
      </div>
    );
  }

  // 既定は自動マッチング（auto）。URL で tab=focus が明示された時のみ注力マッチング。
  const tab: "auto" | "focus" =
    sp.tab === "focus" ? "focus" : "auto";
  const personNo = sp.person ? Number(sp.person) : null;

  // おすすめ（自動マッチング）モードか。担当者フィルタ（?assignee=）で対象人材を絞る。
  //   ・autoMode のときだけ担当者セレクタを出し、担当者が選ばれるまでランキングは計算しない（負荷軽減）。
  const autoMode = tab === "auto" && !sp.job && !sp.person;
  const { parseAssigneeParam } = await import("@/lib/ranking100");
  const assigneeFilter = parseAssigneeParam(sp.assignee);
  const assigneeSelected = !!assigneeFilter;
  // 担当者セレクタ用の件数（operator列のみの軽量集計・5分キャッシュ）。autoMode のときだけ取得。
  let assigneeCounts: { agents: { name: string; count: number }[]; unassigned: number; total: number } =
    { agents: [], unassigned: 0, total: 0 };
  if (autoMode && dbConfigured) {
    try { const { getOperatorCounts } = await import("@/lib/ranking100"); assigneeCounts = await getOperatorCounts(); } catch { /* fail-soft */ }
  }
  const assigneeOpColMissing = autoMode && dbConfigured && assigneeCounts.total === 0 && assigneeCounts.agents.length === 0 && assigneeCounts.unassigned === 0;

  let dbError: string | null = null;

  // 人材→案件モード用
  let person: any = null;
  let rankedJobs: any[] = [];
  // 古い/充足で除外した案件の件数（UI 表示用）
  let hiddenStaleCount = 0;
  let hiddenFilledCount = 0;

  // 案件→人材モード用
  let jobList: any[] = [];
  let job: any = null;
  let ranked: any[] = [];
  // 自動マッチング上位（おすすめの組み合わせ TOP50）。tab=auto かつ案件未指定で表示。
  let autoTop: { rows: any[]; jobsScanned: number; candsScanned: number; pairsHit: number } = { rows: [], jobsScanned: 0, candsScanned: 0, pairsHit: 0 };
  // 注力(ウォッチリスト)モード用
  let focusJobs: any[] = [];   // ♥お気に入り（手動・is_focus）
  let focusCands: any[] = [];
  let recoJobs: any[] = [];    // 自動おすすめ（プロパー/新着で決まりやすい・is_focus以外）
  let recoCands: any[] = [];

  // 提案済み判定（ペア＝job_id×candidate_id）。画面を移動しても「提案済み」を維持し、他ペアに波及させない。
  const proposedJobIds = new Set<string>();   // この人材が既に提案済みの案件id（人材→案件モード）
  const proposedCandIds = new Set<string>();  // この案件で既に提案済みの人材id（案件→人材モード）
  const proposalIdByJob = new Map<string, string>();   // job_id → proposal_id
  const proposalIdByCand = new Map<string, string>();  // candidate_id → proposal_id
  // LINE 由来の案件/人材（signup_source='line' もしくは proposals.source='line'）。名前の横にLINEアイコンを表示する。
  // ENGERフリーランス由来の人材（#260②）は人材IDの横に E マークを表示する。
  const lineJobIds = new Set<string>();
  const lineCandIds = new Set<string>();
  const flCandIds = new Set<string>();
  if (dbConfigured) {
    try { const lo = await getLineOriginIds(); for (const id of lo.jobIds) lineJobIds.add(id); for (const id of lo.candidateIds) lineCandIds.add(id); } catch { /* fail-soft */ }
    try { for (const id of await getFreelanceCandidateIds()) flCandIds.add(id); } catch { /* fail-soft */ }
  }
  // 「誰がいつ提案したか」を表示するための補助マップ。承認状態（pending/approved/rejected/null=旧データ）も保持し、
  // 「承認依頼」ボタンを承認後に「承認済み（下書きへ）」へ自動で切替える表示にも使う。
  const proposalInfoByJob = new Map<string, { proposer: string | null; createdAt: string | null; approvalStatus: string | null }>();
  const proposalInfoByCand = new Map<string, { proposer: string | null; createdAt: string | null; approvalStatus: string | null }>();

  if (dbConfigured) {
    try {
      const sb = engerClient();
      // 注意：flow_depth / accept_flow_depth は supabase/flow-depth.sql 適用後のみ存在。
      //   SELECTに含めると未マイグレ環境で全体が落ちるため、CAND_BASE/JOB_BASE には含めず、
      //   呼出し側で「拡張SELECT → 失敗時は BASE」のフォールバックを掛ける（既存パターン踏襲）。
      const CAND_BASE = "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, nationality, skills, salary_min, salary_max, remote_pref, status, exp, rate, is_focus, avail, location, residence, source_mail_url, note, created_at";
      const CAND_RICH = `${CAND_BASE}, email, contact_email, skill_sheet_url, skill_sheet_summary, flow_depth, deleted_at`;
      const JOB_BASE = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, is_focus, work_location, start_date, status, created_at";
      // 鮮度の最終確認日(last_confirmed_at)は移行後のみ存在。先頭で試し、無ければ created_at にフォールバック。
      // #436②：freelance_ng（フリーランスNG案件のFL系除外）も rich 側で取得（列未整備は BASE へフォールバック）。
      // 0723②：age_limit（手入力の年齢制限）をマッチングの年齢ハードフィルターに使うため取得。
      //   未整備環境では JOB_FRESH クエリがエラー→ JOB_BASE にフォールバックする（既存挙動）。
      const JOB_FRESH = `${JOB_BASE}, last_confirmed_at, accept_flow_depth, freelance_ng, deleted_at, age_limit`;

      // 充足案件（filledJobIds）と送達不能アドレス（bouncedMap）は互いに独立なので並列取得する。
      //   以前は2クエリを直列 await していて遷移のたびに余分な往復が発生していた。
      const filledJobIds = new Set<string>();
      const bouncedMap = new Map<string, { count: number }>();
      {
        const settle = (p: any) => p.then((r: any) => r, (e: any) => ({ error: e }));
        const [fr, br] = await Promise.all([
          settle(sb.from("proposals").select("job_id, stage").in("stage", ["稼働決定", "稼働"]).limit(5000)),
          settle(sb.from("bounce_records").select("recipient_email, bounce_count").limit(10000)),
        ]);
        for (const r of (fr?.data ?? []) as any[]) if (r.job_id) filledJobIds.add(r.job_id);          // proposals 未整備でも続行
        for (const row of (br?.data ?? []) as any[]) bouncedMap.set(String(row.recipient_email ?? "").toLowerCase(), { count: row.bounce_count ?? 1 }); // bounce_records 未整備でも続行
      }
      const markBounce = (j: any) => {
        const em = String(j?.contact_email ?? "").toLowerCase();
        const b = em ? bouncedMap.get(em) : null;
        if (b) { j.is_undeliverable = true; j.undeliverable_count = b.count; }
      };

      // 取得した案件配列に is_filled / is_undeliverable を付与し、充足案件を除外。
      // 古い案件(stale)は showStale=false のとき除外。除外件数も返す。
      const applyOpenness = (jobs: any[]): { kept: any[]; filledCount: number; staleHidden: number } => {
        let filledCount = 0, staleHidden = 0;
        const kept: any[] = [];
        for (const j of jobs) {
          if (j?.deleted_at) continue; // ゴミ箱
          j.is_filled = !!(j.id && filledJobIds.has(j.id));
          markBounce(j);
          const op = jobOpenness(j as Job);
          if (op.closed) { filledCount++; continue; }            // 充足/終了 → 常に除外
          if (!inWindow(j?.created_at)) { staleHidden++; continue; } // マッチング対象期間外 → 隠す（ドリルダウンでは windowActive=false で無効）
          if (!drillDown && op.stale && !showStale) { staleHidden++; continue; } // 古い → 既定で隠す（ドリルダウンでは出してバッジで注意喚起）
          kept.push(j);
        }
        return { kept, filledCount, staleHidden };
      };

      if (personNo) {
        // ---- 人材 → 案件（逆マッチング）----
        let pr: any = await sb.from("candidates").select(CAND_RICH).eq("candidate_no", personNo).maybeSingle();
        if (pr.error) pr = await sb.from("candidates").select(`${CAND_BASE}, email, contact_email, skill_sheet_url`).eq("candidate_no", personNo).maybeSingle();
        person = pr.error ? (await sb.from("candidates").select(CAND_BASE).eq("candidate_no", personNo).maybeSingle()).data : pr.data;
        // 第1優先：企業マスタから contact_name / contact_email を引いて付与
        if (person) await attachCompanyContact(sb, [person], "source_company");
        // 第2優先：旧データで contact_email が無い場合、同じ source_company の他候補から流用
        if (person && !person.contact_email && !person.email && person.source_company) {
          try {
            const fr = await sb.from("candidates").select("contact_email").eq("source_company", person.source_company).not("contact_email", "is", null).limit(1).maybeSingle();
            if (fr.data?.contact_email) person.contact_email = fr.data.contact_email;
          } catch { /* noop */ }
        }

        if (person?.skills?.length) {
          // 取りこぼし低減：保有スキルの「親（内包先）」も検索語に含める
          //   （例: 人材が EC2 を持つ → AWS 要件の案件も拾う）。スコアリングで精査される。
          const personSearchSkills = relatedSearchLabels(person.skills, "parents");
          const buildJ = (cols: string, safe = true) => {
            // 新着優先：job_no 降順（登録が新しい順）で取得。古い案件が上位に居座らないように。
            //   削除済(deleted_at)・クローズ済(is_closed)はサーバ側で必ず除外（一覧と整合）。
            let q: any = sb.from("jobs").select(cols).eq("is_published", true).overlaps("skills", personSearchSkills);
            if (safe) q = q.is("deleted_at", null).eq("is_closed", false);
            // 注力(is_focus)での絞り込みは「注力ボード」用。特定人材へのドリルダウンでは
            //   注力フラグに関係なく合致案件をすべてランキングする（0件事故の防止）。
            if (tab === "focus" && !drillDown) q = q.eq("is_focus", true);
            return q.order("job_no", { ascending: false }).limit(500);
          };
          let jr: any = await buildJ(`${JOB_FRESH}, contact_email, contact_name, source_mail_url`);
          if (jr.error) jr = await buildJ(`${JOB_BASE}, contact_email, contact_name, source_mail_url`);
          if (jr.error) jr = await buildJ(`${JOB_BASE}, contact_email, contact_name`);
          if (jr.error) jr = await buildJ(JOB_BASE);
          if (jr.error) jr = await buildJ(JOB_BASE, false); // deleted_at/is_closed 列が無い旧環境のみ無フィルタ
          // 古い/充足案件を除外（充足は常に・古いは showStale=false のとき）
          const _open = applyOpenness((jr.data ?? []) as any[]);
          hiddenFilledCount += _open.filledCount; hiddenStaleCount += _open.staleHidden;
          // 第1優先：企業マスタから contact_name / contact_email を引いて付与
          const jobList = _open.kept;
          await attachCompanyContact(sb, jobList, "client_name");
          // 第2優先：旧データで contact_email が無い案件は同じ client_name の他案件から流用（同社の窓口メールは共通）
          const jobNeed = jobList.filter((j) => !j.contact_email && j.client_name);
          if (jobNeed.length > 0) {
            const clients = Array.from(new Set(jobNeed.map((j) => j.client_name))) as string[];
            try {
              const jf: any = await sb.from("jobs").select("client_name, contact_email").in("client_name", clients).not("contact_email", "is", null).limit(2000);
              if (!jf.error && Array.isArray(jf.data)) {
                const m: Record<string, string> = {};
                for (const r of jf.data) if (r.client_name && r.contact_email && !m[r.client_name]) m[r.client_name] = r.contact_email;
                for (const j of jobNeed) if (m[j.client_name]) j.contact_email = m[j.client_name];
              }
            } catch { /* noop */ }
          }
          // #345②：「このペアは表示させない」に登録済みの案件は、個別マッチング（人材→案件TOP10）でも除外。
          const hiddenForPerson = await getHiddenPairsSet();
          const jobPool = (jobList as Job[]).filter((j: any) => !j?.deleted_at
            && !(j?.job_no != null && person?.candidate_no != null && hiddenForPerson.has(hiddenPairKey(j.job_no, person.candidate_no))));
          rankedJobs = rankJobs(person as any, jobPool, 10);
          // 元メールリンクを直近受信メールへ更新（同人材／同案件／同送信元の最新メールに飛ぶ）。
          if (person) await attachLatestSourceMail(sb, "candidate", [person]);
          await attachLatestSourceMail(sb, "job", rankedJobs.map((r: any) => r.job));
        }
        // この人材が既に提案済みの案件（提案済み表示用）
        if (person?.id) {
          try {
            // approval_status 列が未整備な旧スキーマでも落ちないようフォールバックする。
            let pr: any = await sb.from("proposals").select("id, job_id, proposer, created_at, approval_status").eq("candidate_id", person.id);
            if (pr.error && /approval_status|column/i.test(pr.error.message ?? "")) {
              pr = await sb.from("proposals").select("id, job_id, proposer, created_at").eq("candidate_id", person.id);
            }
            for (const r of (pr.data ?? []) as any[]) {
              if (!r.job_id) continue;
              proposedJobIds.add(r.job_id); proposalIdByJob.set(r.job_id, r.id);
              proposalInfoByJob.set(r.job_id, { proposer: r.proposer ?? null, createdAt: r.created_at ?? null, approvalStatus: r.approval_status ?? null });
            }
          } catch { /* proposals未整備でも続行 */ }
        }
      } else if (tab === "focus" && !drillDown) {
        // 注力ボード（♥お気に入り＋自動おすすめ）。ただし特定案件を選んだドリルダウン(?job=)では
        //   ここに入らず、下の else（案件→人材の取得）へ進める。これをしないと注力モード時に
        //   選択案件のデータ(job/ranked)が取得されず、ランキングが空のままになる。
        const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const JOB_F = JOB_BASE; // status, created_at は JOB_BASE に含む
        const CAND_F = `${CAND_BASE}, created_at`;
        // 注力(♥)一覧には「注力登録日」(focused_at)を表示する（#316③）。列未整備環境では
        //   primary が落ちるため、focused_at 抜きの BASE へフォールバックする（safe の fb）。
        //   自動おすすめ(recJobs/ppCands/recCands)は fb が空配列なので focused_at を足さない。
        const JOB_FF = `${JOB_BASE}, focused_at`;
        const CAND_FF = `${CAND_BASE}, created_at, focused_at`;
        const safe = async (q: any, fb: any) => { const r = await q; return r.error ? ((await fb)?.data ?? []) : (r.data ?? []); };
        const [hjJobs, recJobs, hfCands, ppCands, recCands] = await Promise.all([
          safe(sb.from("jobs").select(JOB_FF).eq("is_published", true).eq("is_focus", true).limit(200), sb.from("jobs").select(JOB_BASE).eq("is_published", true).eq("is_focus", true).limit(200)),
          safe(sb.from("jobs").select(JOB_F).eq("is_published", true).gte("created_at", since30).limit(300), Promise.resolve({ data: [] })),
          safe(sb.from("candidates").select(CAND_FF).eq("is_focus", true).limit(200), sb.from("candidates").select(CAND_BASE).eq("is_focus", true).limit(200)),
          safe(sb.from("candidates").select(CAND_F).or("affiliation.eq.PP,affiliation.ilike.%プロパー%").limit(300), Promise.resolve({ data: [] })),
          safe(sb.from("candidates").select(CAND_F).gte("created_at", since30).limit(400), Promise.resolve({ data: [] })),
        ]);
        // ♥お気に入り（手動）：ハートが点灯し、外すと件数が減る。充足/古い案件は除外。
        focusJobs = applyOpenness(hjJobs as any[]).kept.slice(0, 100);
        focusCands = (hfCands as any[]).slice(0, 100);
        // 自動おすすめ：プロパー・新着で決まりやすい。is_focus は注力側に出すので除外。充足/古いも除外。
        recoJobs = applyOpenness(curateFocus("jobs", recJobs).filter((j) => !j.is_focus)).kept.slice(0, 40);
        recoCands = curateFocus("cands", [...ppCands, ...recCands]).filter((c) => !c.is_focus).slice(0, 40);
      } else {
        // ---- 自動マッチング = 全データから合う候補をランキング（案件 → 人材）----
        // 上部に「おすすめの組み合わせ TOP50」（高マッチ率×新案件×新人材・人材/案件は重複なし）を表示する。
        //   ただし個別の案件・人材から「マッチングボタン」で遷移した時（?job=… / ?person=…）は
        //   絞り込み結果に集中させるため非表示にする（要望対応）。その場合は取得自体スキップ。
        // おすすめは担当者が選ばれたときだけ計算する（負荷軽減＝遅延ロード）。
        if (autoMode && assigneeSelected) {
          try {
            const { getAutoMatchTopFor } = await import("@/lib/ranking100");
            autoTop = await getAutoMatchTopFor(assigneeFilter!);
          } catch { /* TOP50 取得失敗時はセクション非表示で続行 */ }
        }
        // 削除済(deleted_at)・クローズ済(is_closed)はサーバ側で必ず除外（一覧と整合させる）。
        const buildList = (cols: string, safe = true) => {
          let q: any = sb.from("jobs").select(cols).eq("is_published", true).neq("skills", "{}");
          if (safe) q = q.is("deleted_at", null).eq("is_closed", false);
          return q.order("job_no", { ascending: false }).limit(120);
        };
        let jlRes: any = await buildList(`${JOB_FRESH}, contact_email, contact_name, source_mail_url`);
        if (jlRes.error) jlRes = await buildList(`${JOB_BASE}, contact_email, contact_name, source_mail_url`);
        if (jlRes.error) jlRes = await buildList(`${JOB_BASE}, contact_email, contact_name`);
        if (jlRes.error) jlRes = await buildList(JOB_BASE);
        if (jlRes.error) jlRes = await buildList(JOB_BASE, false); // deleted_at/is_closed 列が無い旧環境のみ無フィルタ
        // 充足/古い案件を選択ドロップダウンから除外（充足は常に・古いは showStale=false のとき）
        const _openList = applyOpenness(jlRes.data ?? []);
        hiddenFilledCount += _openList.filledCount; hiddenStaleCount += _openList.staleHidden;
        jobList = _openList.kept;

        const reqJobNo = sp.job ? Number(sp.job) : null;
        if (reqJobNo) {
          // 指定された job_no が jobList(最新120件)に無いとき jobList[0] にフォールバックして
          // 異なる案件の結果が表示される不具合があったため、必ず個別取得する。
          job = jobList.find((j) => j.job_no === reqJobNo) ?? null;
          if (!job) {
            let jr: any = await sb.from("jobs").select(`${JOB_FRESH}, contact_email, contact_name, source_mail_url`).eq("job_no", reqJobNo).maybeSingle();
            if (jr.error) jr = await sb.from("jobs").select(`${JOB_BASE}, contact_email, contact_name, source_mail_url`).eq("job_no", reqJobNo).maybeSingle();
            if (jr.error) jr = await sb.from("jobs").select(`${JOB_BASE}, contact_email, contact_name`).eq("job_no", reqJobNo).maybeSingle();
            if (jr.error) jr = await sb.from("jobs").select(JOB_BASE).eq("job_no", reqJobNo).maybeSingle();
            if (jr.data) {
              job = jr.data;
              // 直接指定された案件は充足/古くても表示する（バナーで警告）。is_filled を付与。
              job.is_filled = !!(job.id && filledJobIds.has(job.id));
              // ドロップダウン用に jobList の先頭に挿入（重複しないように）
              if (!jobList.find((j) => j.job_no === job.job_no)) jobList = [job, ...jobList];
            }
          }
        }
        if (!job) job = jobList[0] ?? null;
        // 第1優先：企業マスタから contact_name / contact_email を引いて付与
        if (job) await attachCompanyContact(sb, [job], "client_name");
        // 第2優先：旧データで contact_email が無い案件は同じ client_name の他案件から流用
        if (job && !job.contact_email && job.client_name) {
          try {
            const jf: any = await sb.from("jobs").select("contact_email").eq("client_name", job.client_name).not("contact_email", "is", null).limit(1).maybeSingle();
            if (jf.data?.contact_email) job.contact_email = jf.data.contact_email;
          } catch { /* noop */ }
        }

        if (job?.skills?.length) {
          // 取りこぼし低減：要求スキルの「子孫（具体サービス/フレームワーク）」も検索語に含める
          //   （例: 案件が AWS 要件 → EC2/S3 等を持つ人材も拾う）。スコアリングで精査される。
          const jobSearchSkills = relatedSearchLabels(job.skills, "children");
          // 新着優先：candidate_no 降順（＝登録が新しい順）で取得。古い候補が上位に居座る問題の対策。
          //   ★削除済(deleted_at)・クローズ済(is_closed)はサーバ側で必ず除外する。
          //     以前は JS 側の !c.deleted_at だけで弾いていたが、列省略フォールバックの SELECT では
          //     deleted_at が取れず、削除済み人材がマッチングに出る（一覧には無い）不具合があった。
          const buildC = (cols: string, safe = true) => {
            let q: any = sb.from("candidates").select(cols).overlaps("skills", jobSearchSkills);
            if (safe) q = q.is("deleted_at", null).eq("is_closed", false);
            return q.order("candidate_no", { ascending: false }).limit(200);
          };
          let cr: any = await buildC(CAND_RICH);
          if (cr.error) cr = await buildC(`${CAND_BASE}, email, contact_email, skill_sheet_url`);
          if (cr.error) cr = await buildC(`${CAND_BASE}, email, contact_email`);
          if (cr.error) cr = await buildC(CAND_BASE);
          if (cr.error) cr = await buildC(CAND_BASE, false); // deleted_at/is_closed 列が無い旧環境のみ無フィルタ
          // 旧データで contact_email が無い候補は同じ source_company の他候補から流用（メールは同じSES窓口）
          const candList = (cr.data ?? []) as any[];
          // 指定された candidate_no が skills-overlap で取得できていない場合は個別に取得して追加
          const reqCandNo = sp.cand ? Number(sp.cand) : null;
          if (reqCandNo && !candList.find((c) => c.candidate_no === reqCandNo)) {
            let xr: any = await sb.from("candidates").select(CAND_RICH).eq("candidate_no", reqCandNo).maybeSingle();
            if (xr.error) xr = await sb.from("candidates").select(`${CAND_BASE}, email, contact_email, skill_sheet_url`).eq("candidate_no", reqCandNo).maybeSingle();
            if (xr.error) xr = await sb.from("candidates").select(CAND_BASE).eq("candidate_no", reqCandNo).maybeSingle();
            if (xr.data) candList.push(xr.data);
          }
          // 第1優先：企業マスタから contact_name / contact_email を引いて付与
          await attachCompanyContact(sb, candList, "source_company");
          // 第2優先：旧データで contact_email が無い候補は同じ source_company の他候補から流用（メールは同じSES窓口）
          const need = candList.filter((c) => !c.contact_email && !c.email && c.source_company);
          if (need.length > 0) {
            const companies = Array.from(new Set(need.map((c) => c.source_company))) as string[];
            try {
              const fr: any = await sb.from("candidates").select("source_company, contact_email").in("source_company", companies).not("contact_email", "is", null).limit(2000);
              if (!fr.error && Array.isArray(fr.data)) {
                const m: Record<string, string> = {};
                for (const r of fr.data) if (r.source_company && r.contact_email && !m[r.source_company]) m[r.source_company] = r.contact_email;
                for (const c of need) if (m[c.source_company]) c.contact_email = m[c.source_company];
              }
            } catch { /* noop */ }
          }
          // マッチング対象期間外（取込が古い）の人材は除外。明示指定された候補(reqCandNo)は残す。
          // #345②：「このペアは表示させない」に登録済みの人材も、個別マッチング（案件→人材TOP10）から除外
          //   （?cand= で明示指定されたペアのドリルダウンは業務確認用に残す）。
          const hiddenForJob = await getHiddenPairsSet();
          const candInWindow = candList.filter((c: any) => !c?.deleted_at && (inWindow(c?.created_at) || c.candidate_no === reqCandNo))
            .filter((c: any) => !((job as any)?.job_no != null && c?.candidate_no != null && c.candidate_no !== reqCandNo
              && hiddenForJob.has(hiddenPairKey((job as any).job_no, c.candidate_no))));
          ranked = rankCandidates(job as Job, candInWindow, 10);
          // 指定された候補者が ranked(上位10)に入っていない場合は個別にスコア計算して先頭に挿入。
          //   #364：提案レコード等から ?cand= で明示指定されたペアは業務確認用のドリルダウン。
          //   除外フィルタ（国籍NG/商流NG/充足等）で弾かれても、必ず「その人材」を先頭に表示する。
          //   ここで挿入に失敗すると sel が別人材(ranked[0])にフォールバックし、
          //   別人のスキルシートでメールが作られる事故になる（本チケットの症状）。
          const reqCandNo2 = sp.cand ? Number(sp.cand) : null;
          if (reqCandNo2 && !ranked.find((r: any) => r.candidate.candidate_no === reqCandNo2)) {
            const tgt = candList.find((c) => c.candidate_no === reqCandNo2);
            if (tgt) {
              // 通常のランキング（除外フィルタ適用）で拾えればそれを使い、弾かれる場合は
              // scoreMatch で直接採点した結果を使って、必ず対象人材を先頭に出す。
              const single = rankCandidates(job as Job, [tgt], 1);
              const entry = single.length ? single[0] : ({ candidate: tgt, ...scoreMatch(job as Job, tgt) } as any);
              ranked = [entry, ...ranked.filter((r: any) => r.candidate.candidate_no !== reqCandNo2)];
            }
          }
        }
        // 元メールリンクを直近受信メールへ更新（同案件／同人材／同送信元の最新メールに飛ぶ）。
        if (job) await attachLatestSourceMail(sb, "job", [job]);
        await attachLatestSourceMail(sb, "candidate", ranked.map((r: any) => r.candidate));
        // この案件で既に提案済みの人材（提案済み表示用）
        if (job?.id) {
          try {
            // approval_status 列が未整備な旧スキーマでも落ちないようフォールバックする。
            let pr: any = await sb.from("proposals").select("id, candidate_id, proposer, created_at, approval_status").eq("job_id", job.id);
            if (pr.error && /approval_status|column/i.test(pr.error.message ?? "")) {
              pr = await sb.from("proposals").select("id, candidate_id, proposer, created_at").eq("job_id", job.id);
            }
            for (const r of (pr.data ?? []) as any[]) {
              if (!r.candidate_id) continue;
              proposedCandIds.add(r.candidate_id); proposalIdByCand.set(r.candidate_id, r.id);
              proposalInfoByCand.set(r.candidate_id, { proposer: r.proposer ?? null, createdAt: r.created_at ?? null, approvalStatus: r.approval_status ?? null });
            }
          } catch { /* proposals未整備でも続行 */ }
        }
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else dbError = "Supabase の環境変数が未設定です";

  // #315：LINE登録の人材／案件には、企業名やGメールを「勝手に」紐づけない。
  //   LINE経由（signup_source='line' 等＝lineCandIds/lineJobIds）で登録された行に、
  //   企業マスタ由来の窓口メール（contact_email）や受信箱の元メール（source_mail_url）を
  //   後付けしてしまうと、「LINEで繋がっていない企業/Gメールの一覧に飛ぶ」事故になる。
  //   そこで表示直前に、対象行の 所属企業／窓口メール／元メールリンクをこの画面上でだけ伏せる。
  //   （DBは変更しない。判定は名前横のLINEアイコンと同じ lineCandIds/lineJobIds を使う。）
  //   合わせて _isLine フラグを全行に付与する（#316②：注力ボード一覧のLINEバッジ表示用。
  //   FocusList はクライアント側なので Set を渡せず、行に真偽値を載せて判定する）。
  const scrubLineCand = (c: any) => {
    if (!c) return;
    const isLine = lineCandIds.has(c.id);
    c._isLine = isLine;
    if (!isLine) return;
    c.source_company = null; c.company = null;
    c.contact_email = null; c.company_contact_email = null;
    c.source_mail_url = null; c.source_mail_at = null; c.source_mail_subject = null;
  };
  const scrubLineJob = (j: any) => {
    if (!j) return;
    const isLine = lineJobIds.has(j.id);
    j._isLine = isLine;
    if (!isLine) return;
    j.client_name = null;
    j.contact_email = null; j.company_contact_email = null;
    j.source_mail_url = null; j.source_mail_at = null; j.source_mail_subject = null;
  };
  scrubLineCand(person);
  scrubLineJob(job);
  for (const r of rankedJobs) scrubLineJob(r?.job);
  for (const r of ranked) scrubLineCand(r?.candidate);
  for (const j of jobList) scrubLineJob(j);
  for (const j of focusJobs) scrubLineJob(j);
  for (const j of recoJobs) scrubLineJob(j);
  for (const c of focusCands) scrubLineCand(c);
  for (const c of recoCands) scrubLineCand(c);
  for (const row of autoTop.rows) { scrubLineJob(row?.job); scrubLineCand(row?.cand); }

  // 期間セレクタ（統一デザイン）で、登録日(created_at)によりマッチング対象を絞り込む。
  //   既定 all は no-op。選択中の案件/人材は誤って消えないよう常に残す（carve-out）。
  if (periodActive) {
    const keepJob = (j: any) => inMPeriod(j?.created_at) || (job && j?.job_no === job.job_no);
    const keepCand = (c: any) => inMPeriod(c?.created_at) || (sp.cand && String(c?.candidate_no) === sp.cand);
    // 案件→人材：候補ランキング（cand.created_at）
    ranked = ranked.filter((r: any) => keepCand(r?.candidate));
    // 人材→案件：案件ランキング（job.created_at）
    rankedJobs = rankedJobs.filter((r: any) => keepJob(r?.job));
    // 案件ピッカー／注力ボード
    jobList = jobList.filter(keepJob);
    focusJobs = focusJobs.filter(keepJob);
    recoJobs = recoJobs.filter(keepJob);
    focusCands = focusCands.filter(keepCand);
    recoCands = recoCands.filter(keepCand);
    // おすすめ TOP50：案件 or 人材が期間内のペアを残す
    autoTop = { ...autoTop, rows: autoTop.rows.filter((r: any) => inMPeriod(r?.job?.created_at) || inMPeriod(r?.cand?.created_at)) };
  }
  // 0722②③：おすすめ TOP50 の最終防衛線。5分キャッシュの残り時間や期間切替に左右されず、
  //   「このペアを表示させない」済みペア・クローズ済/削除済みの案件・人材が絶対に出ないよう、
  //   表示直前に最新のDB状態で再フィルタする（build段の除外＋キャッシュ無効化に加えた三重の保険）。
  if (dbConfigured && autoTop.rows.length > 0) {
    try {
      const hiddenNow = await getHiddenPairsSet();
      if (hiddenNow.size > 0) {
        autoTop = { ...autoTop, rows: autoTop.rows.filter((r: any) => !hiddenNow.has(hiddenPairKey(r?.job?.job_no, r?.cand?.candidate_no))) };
      }
      const sbGuard = engerClient();
      const jobIds = Array.from(new Set(autoTop.rows.map((r: any) => r?.job?.id).filter(Boolean)));
      const candIds = Array.from(new Set(autoTop.rows.map((r: any) => r?.cand?.id).filter(Boolean)));
      const closedJob = new Set<string>(); const closedCand = new Set<string>();
      if (jobIds.length > 0) {
        const r: any = await sbGuard.from("jobs").select("id").in("id", jobIds).or("is_closed.eq.true,deleted_at.not.is.null");
        if (!r.error) for (const x of (r.data ?? []) as any[]) closedJob.add(String(x.id));
      }
      if (candIds.length > 0) {
        const r: any = await sbGuard.from("candidates").select("id").in("id", candIds).or("is_closed.eq.true,deleted_at.not.is.null");
        if (!r.error) for (const x of (r.data ?? []) as any[]) closedCand.add(String(x.id));
      }
      if (closedJob.size > 0 || closedCand.size > 0) {
        autoTop = { ...autoTop, rows: autoTop.rows.filter((r: any) => !closedJob.has(String(r?.job?.id ?? "")) && !closedCand.has(String(r?.cand?.id ?? ""))) };
      }
    } catch { /* 最終フィルタ失敗時は従来表示（build段の除外は効いている） */ }
  }
  // おすすめは点数順で上位50件に確定し、順位を振り直す（期間フィルタ後でも1〜50位が連番になる）。
  autoTop = { ...autoTop, rows: autoTop.rows.slice(0, 50).map((r: any, i: number) => ({ ...r, rank: i + 1 })) };

  // 送達不能アドレスの照会（バナー表示用）。is_undeliverable は既に各 job に付与済み（applyOpenness内）。
  const bouncedSet: Map<string, BounceRecord> = await getBouncedSet([
    job?.contact_email,
    ...rankedJobs.map((r: any) => r?.job?.contact_email),
    ...focusJobs.map((j: any) => j?.contact_email),
    ...recoJobs.map((j: any) => j?.contact_email),
  ]);

  // 古い/充足で除外している件数のお知らせ＋「古い案件も表示」トグル（鮮度ガードの可視化）
  const buildToggleHref = (toStale: boolean) => {
    const p = new URLSearchParams();
    if (tab === "focus") p.set("tab", "focus");
    if (personNo) p.set("person", String(personNo));
    if (sp.cand) p.set("cand", sp.cand);
    if (sp.job) p.set("job", sp.job);
    if (toStale) p.set("stale", "1");
    const qs = p.toString();
    return `/matching${qs ? `?${qs}` : ""}`;
  };
  // 表示中の案件で送達不能になっているもののカウント（マッチング画面の警告サマリ用）
  const undeliverableShown = [
    ...rankedJobs.map((r: any) => r?.job),
    ...focusJobs, ...recoJobs,
    ...(job ? [job] : []),
  ].filter((j: any) => j?.is_undeliverable).length;

  const opennessBanner = (windowActive || hiddenFilledCount > 0 || hiddenStaleCount > 0 || showStale || undeliverableShown > 0) ? (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 12.5 }}>
      <span style={{ fontWeight: 700 }}>🛡 鮮度ガード</span>
      {windowActive && <span style={{ color: "#0b5cab" }}>📅 直近<b>{matchWindow.days}日</b>でマッチング中</span>}
      {hiddenFilledCount > 0 && <span style={{ color: "#b42318" }}>🔒 充足/終了 <b>{hiddenFilledCount}</b>件を除外</span>}
      {hiddenStaleCount > 0 && <span style={{ color: "#b45309" }}>🕓 期間外/古い <b>{hiddenStaleCount}</b>件を{showStale ? "表示中" : "非表示"}</span>}
      {showStale && hiddenStaleCount === 0 && <span style={{ color: "#b45309" }}>🕓 期間外も表示中（在否確認のうえ提案を）</span>}
      {undeliverableShown > 0 && <span style={{ color: "#b42318" }}>📭 宛先が送達不能の案件 <b>{undeliverableShown}</b>件あり（提案前に連絡先確認）</span>}
      <Link href={buildToggleHref(!showStale)} className="btn ghost btn-xs" style={{ marginLeft: "auto", textDecoration: "none" }}>
        {showStale ? "期間内のみ表示" : "期間外も表示する"}
      </Link>
    </div>
  ) : null;

  // 選択中の案件が充足/古い/送達不能の場合の警告バナー（個別案件を直接開いたケース）
  const selectedJobWarning = (j: any) => {
    if (!j) return null;
    const op = jobOpenness(j as Job);
    const bounce = (j?.contact_email && bouncedSet.get(String(j.contact_email).toLowerCase())) || null;
    if (!op.closed && !op.stale && !bounce) return null;
    if (bounce && !op.closed && !op.stale) {
      // 送達不能のみ：単独で目立つバナーを出す
      return (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: "#fdecef", border: "1px solid #f7c5cf", color: "#b42318", fontSize: 12.5, fontWeight: 600 }}>
          <span>📭 この案件の宛先 <b>{j.contact_email}</b> は <b>送達不能</b>（{bounce.bounce_count}回観測）。提案前に正しい連絡先を確認してください。</span>
          {bounce.last_reason && <span className="muted" style={{ fontSize: 11, fontWeight: 400, color: "#b42318" }}>理由：{bounce.last_reason}</span>}
        </div>
      );
    }
    const danger = op.closed;
    return (
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: danger ? "#fdecef" : "#fff6e0", border: `1px solid ${danger ? "#f7c5cf" : "#fde9b0"}`, color: danger ? "#b42318" : "#92400e", fontSize: 12.5, fontWeight: 600 }}>
        <span>
          {danger
            ? <>🔒 この案件は <b>{op.closedReason}</b>。新たな提案は推奨されません（再提案は信用を損ないます）。</>
            : <>🕓 この案件は <b>配信から約{op.staleDays}日</b>・在否未確認です。提案前に先方へ募集継続を確認してください。</>}
        </span>
        {!danger && j.job_no != null && <span style={{ marginLeft: "auto" }}><ConfirmJobButton jobNo={j.job_no} /></span>}
      </div>
    );
  };

  // ENGER→LINE 共有（「LINEに送る」）の宛先候補。両モードのヘッダで使う。
  const lwTargets = await listLineworksTargets();

  // ============ 人材 → 案件モードの描画 ============
  if (personNo) {
    const selJob = sp.job ? rankedJobs.find((r) => String(r.job.job_no) === sp.job) : rankedJobs[0];
    const sel = selJob ?? rankedJobs[0];

    return (
      <div className="page">
        <MatchingPeerTabs counts={peerCounts} rightSlot={<MatchingPeriodChips />} />

        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Matching · 人材 → 案件（AI分析）</div>
            <h1>{person?.name ?? "人材"} に合う案件</h1>
            <div className="sub">この人材のスキルを主軸に、単価・職種・リモート条件で補正して案件をランキング表示します。</div>
          </div>
          {/* ヘッダの「LINEに送る」は廃止（マッチ結果カード内の LINEに送る＝雛形確認つき に集約）。
              外部共有もマッチ結果カード内の「共有」行に集約（ボタン整理）。 */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <CopyLinkButton />
            <Link href="/people" className="btn ghost" style={{ textDecoration: "none" }}>← 人材一覧へ</Link>
          </div>
        </div>

        {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

        {opennessBanner}
        {selectedJobWarning(sel?.job)}

        {/* スキル未登録の人材はマッチング（スキル一致でのランキング）ができないため、0件の理由を明示する。
            LINE取込などでスキルが抽出されていない人材で「マッチング」を押したときの無言0件対策。 */}
        {person && !(person.skills?.length) && (
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", marginBottom: 12, background: "#fff6e0", border: "1px solid #fde9b0", color: "#92400e", fontSize: 13 }}>
            <span style={{ fontWeight: 700 }}>⚠ スキルが未登録です</span>
            <span>この人材は<b>スキルが登録されていない</b>ため、マッチング（スキル一致による案件ランキング）ができません。LINE取込などでスキルが抽出されていない場合に起こります。人材を編集してスキルを追加すると、ここに案件が表示されます。</span>
            <Link href={`/people?focus=${person.candidate_no}`} className="btn ghost btn-xs" style={{ marginLeft: "auto", textDecoration: "none", whiteSpace: "nowrap" }}>人材を編集してスキルを登録</Link>
          </div>
        )}

        {person && (
          <div className="match-side-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
            {/* 左: 案件ランキング（AI再ランキング対応） */}
            <RankJobList
              personNo={person.candidate_no}
              tab={tab}
              selJobNo={sel?.job.job_no}
              ranked={rankedJobs}
              proposedJobIds={proposedJobIds}
              lineJobIds={lineJobIds}
              candForAI={{
                candidate_no: person.candidate_no, name: person.name, title: person.title,
                skills: person.skills, rate: person.rate, exp: person.exp, remote_pref: person.remote_pref,
                skill_sheet_summary: (person as any).skill_sheet_summary ?? null,
              }}
            />

            {/* 右: 詳細 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 人材</span>
                  <FocusHeart table="candidates" idField="candidate_no" idValue={person.candidate_no} initial={!!person.is_focus} revalidate="/matching" size={16} row={person} />
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)" }}>候補 {rankedJobs.length}件</span>
                </div>
                {/* 人材名クリック＝外部共有ページのプレビュー（デザイン確認＋URLコピー）。社内ロールのみ。 */}
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--color-ink)" }}>{lineCandIds.has(person.id) && <span title="LINE経由の人材" style={{ lineHeight: 0, verticalAlign: "-2px", marginRight: 4, display: "inline-flex" }}><Icons.line size={15} /></span>}{scope.isInternal ? (
                  <ShareExternalButton kind="candidate" no={person.candidate_no}>
                    {person.name}
                    <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, color: "var(--color-brand-700)", marginLeft: 4, verticalAlign: "-2px" }}>ios_share</span>
                  </ShareExternalButton>
                ) : person.name} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(person.candidate_no).padStart(5, "0")}</span>{flCandIds.has(person.id) && <span title="ENGERフリーランスで登録された人材" style={{ lineHeight: 0, verticalAlign: "-2px", marginLeft: 4, display: "inline-flex" }}><Icons.engerFreelance size={15} /></span>}</div>
                <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, color: "var(--color-ink-3)", flexWrap: "wrap", alignItems: "center" }}>
                  {person.title && <span className="tag">{person.title}</span>}
                  {(person.source_company || person.company) && <span className="tag">{person.source_company || person.company}</span>}
                  {person.affiliation && <span className="tag">{person.affiliation}</span>}
                  {/* リモート希望・国籍・最寄駅・年代を明示。デザインは他項目と統一（プレーンな tag）。 */}
                  <span className="tag">リモート {candRemoteLabel(person.remote_pref) === "—" ? (person.remote_pref ?? "—") : candRemoteLabel(person.remote_pref)}</span>
                  <span className="tag">国籍 {CAND_NAT_LABEL[classifyCandNationality(person.nationality)]}</span>
                  <span className="tag">最寄駅 {person.location ?? "不明"}</span>
                  {person.age_band && <span className="tag">年齢（年代） {person.age_band}</span>}
                  {person.exp != null && String(person.exp).trim() !== "" && <span className="tag">経験 {/^\d+$/.test(String(person.exp).trim()) ? `${String(person.exp).trim()}年` : person.exp}</span>}
                  {person.avail && <span className="tag">稼働開始予定日 {person.avail}</span>}
                  <span className="tag">{person.rate ?? salaryLabel(person.salary_min, person.salary_max)}</span>
                </div>
                {person.skills?.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                    {person.skills.slice(0, 12).map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 10.5 }}>{s}</span>)}
                  </div>
                )}
              </div>

              {sel && (() => {
                const j = sel.job;
                const rank = rankedJobs.findIndex((r) => r.job.job_no === j.job_no) + 1;
                const skillPct = j.skills?.length ? Math.round((sel.matchedSkills.length / j.skills.length) * 100) : 0;
                return (
                  <div className="card flush">
                    <div style={{ padding: "14px 20px", background: "#fffbeb", borderBottom: "1px solid #fde9b0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>🏆 {rank}位（要件スキル {skillPct}%）</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {(() => { const v = verdictStyle(sel.verdict); return (<span style={{ fontWeight: 700, fontSize: 11.5, padding: "3px 10px", borderRadius: 99, background: v.bg, color: v.fg, border: `1px solid ${v.bd}` }}>{sel.verdict}</span>); })()}
                        <span className="tag brand" style={{ fontWeight: 700 }}>マッチ度 {sel.score}%</span>
                      </div>
                    </div>
                    <div style={{ padding: 20 }}>
                      {/* 案件名クリック＝外部共有ページのプレビュー（デザイン確認＋URLコピー）。社内ロールのみ。 */}
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{lineJobIds.has(j.id) && <span title="LINE経由の案件" style={{ lineHeight: 0, verticalAlign: "-2px", marginRight: 4, display: "inline-flex" }}><Icons.line size={15} /></span>}{scope.isInternal ? (
                        <ShareExternalButton kind="job" no={j.job_no}>
                          {j.title}
                          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, color: "var(--color-brand-700)", marginLeft: 4, verticalAlign: "-2px" }}>ios_share</span>
                        </ShareExternalButton>
                      ) : j.title} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(j.job_no).padStart(5, "0")}</span></div>
                      {/* クライアント名・職種・リモート・勤務地・単価に加え、商流・年代制限・国籍要件も表示（要望③）。
                          年代制限/国籍要件は案件本文(detail+title)から判定（一覧の表示ロジックと同じ）。 */}
                      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{[
                        j.client_name,
                        j.role_label,
                        remoteLabel(j.remote_type),
                        j.work_location,
                        salaryLabel(j.salary_min, j.salary_max),
                        (j.flow_note && String(j.flow_note).trim()) ? `商流制限 ${displayFlowNote(j.flow_note)}` : null,
                        `年代 ${classifyJobAge(j.detail, j.title).label}`,
                        `国籍 ${JOB_NAT_LABEL[classifyJobNationality(j.detail, j.title)]}`,
                      ].filter(Boolean).join(" / ")}</div>

                      {/* 提案フォームを最上部に（すぐ送れるように） */}
                      <ProposalComposer key={`${j.job_no}-${person?.candidate_no}`} job={j} cand={person} matchedSkills={sel.matchedSkills} missingSkills={sel.missingSkills} score={sel.score} lineTargets={lwTargets}
                        alreadyProposed={proposedJobIds.has(j.id)} proposalId={proposalIdByJob.get(j.id) ?? null}
                        proposedBy={proposalInfoByJob.get(j.id)?.proposer ?? null}
                        proposedAt={proposalInfoByJob.get(j.id)?.createdAt ?? null}
                        approvalStatus={proposalInfoByJob.get(j.id)?.approvalStatus ?? null}
                        members={proposerMembers}
                        shareJobNo={scope.isInternal ? (j.job_no ?? null) : null}
                        shareCandNo={scope.isInternal ? (person?.candidate_no ?? null) : null} />

                      {/* マッチ詳細はアコーディオン（既定は閉。注意件数はサマリに表示） */}
                      {(() => {
                        const reds = sel.notes.filter((n: { level: string }) => n.level === "red").length;
                        const yels = sel.notes.filter((n: { level: string }) => n.level === "yellow").length;
                        return (
                          <details style={{ marginTop: 14, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
                            <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-2)" }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-ink-4)" }}>expand_more</span>
                              📋 マッチ詳細（スキル評価・内訳・注意点）
                              {reds > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: "#fdecef", color: "#b42318" }}>🔴 {reds}</span>}
                              {yels > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: "#fff6e0", color: "#9a7b12" }}>🟡 {yels}</span>}
                            </summary>
                            <div className="match-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start", marginTop: 12 }}>
                              <div>
                                <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>スキル評価</div>
                                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                                  {sel.matchedSkills.map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 11 }}>✓ {s}</span>)}
                                  {sel.missingSkills.map((s: string) => <span key={s} className="tag" style={{ fontSize: 11, background: "transparent", border: "1px dashed var(--color-border-strong)", color: "var(--color-ink-4)" }}>未 {s}</span>)}
                                </div>
                              </div>
                              <NotesPanel sel={sel} />
                            </div>
                          </details>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ 注力マッチング（ウォッチリスト）の描画 ============
  //   ※ 特定の案件/人材を選んだドリルダウン（?job= / ?person=）では注力ボードを出さず、
  //     下のドリルダウン描画にフォールスルーする。これをしないと、注力ボードから
  //     「マッチング」を押しても tab=focus のまま注力ボードに戻り、ランキングが出ない。
  if (tab === "focus" && !drillDown) {
    return (
      <div className="page">
        <MatchingPeerTabs counts={peerCounts} rightSlot={<MatchingPeriodChips />} />
        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Matching · 注力（優先対応）</div>
            <h1>注力マッチング</h1>
            <div className="sub"><b>注力</b>＝<span style={{ color: "#e0567f" }}>♥</span>お気に入り（手動）。ハートを押すと注力に入り、外すと件数が減ります。<b>自動おすすめ</b>＝プロパー・新着で決まりやすい候補（♥を押すと注力に固定）。</div>
          </div>
        </div>
        <MatchingModeTabs />
        {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
        {opennessBanner}

        {/* 注力（♥お気に入り・手動）：ハートを外すと即座に件数・行が減る */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          <FocusList kind="jobs" items={focusJobs} unit="件" removeOnUnheart lineTargets={lwTargets}
            headerTitle={<><span style={{ color: "#e0567f" }}>♥</span> 注力案件</>}
            emptyText={<>案件一覧やマッチングで <span style={{ color: "#e0567f" }}>♥</span> を押すとここに表示されます</>} />
          <FocusList kind="people" items={focusCands} unit="名" removeOnUnheart lineTargets={lwTargets}
            headerTitle={<><span style={{ color: "#e0567f" }}>♥</span> 注力人材</>}
            emptyText={<>人材一覧やマッチングで <span style={{ color: "#e0567f" }}>♥</span> を押すとここに表示されます</>} />
        </div>

        {/* 自動おすすめ（プロパー・新着で決まりやすい・is_focus以外） */}
        {(recoJobs.length > 0 || recoCands.length > 0) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start", marginTop: 16 }}>
            <div className="card flush">
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>💡 自動おすすめ案件</div><span className="tag">{recoJobs.length}件</span>
              </div>
              {recoJobs.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>新着の決まりやすい案件はありません</div> : <FocusList kind="jobs" items={recoJobs} lineTargets={lwTargets} />}
            </div>
            <div className="card flush">
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>💡 自動おすすめ人材</div><span className="tag">{recoCands.length}名</span>
              </div>
              {recoCands.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>プロパー・新着の決まりやすい人材はありません</div> : <FocusList kind="people" items={recoCands} lineTargets={lwTargets} />}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ 案件 → 人材モードの描画 ============
  const selIdx = sp.cand ? ranked.findIndex((r) => String(r.candidate.candidate_no) === sp.cand) : 0;
  // #364：?cand= が明示指定されているのに見つからない場合は、別人材(ranked[0])へフォールバックしない。
  //   （フォールバックすると別人のスキルシートでメールが作られる事故になるため、sel は undefined にして
  //    「指定の人材が見つかりません」を表示する。）
  const sel = sp.cand ? (selIdx >= 0 ? ranked[selIdx] : undefined) : ranked[0];
  const jobAbbr = (job?.title ?? "").slice(0, 3);
  const linkFor = (cand?: number) => `/matching?tab=${tab}&job=${job?.job_no ?? ""}${cand != null ? `&cand=${cand}` : ""}`;

  return (
    <div className="page">
      {/* タブを最上段に置く（LINEと同じ配置。タブ移動時に段差が出ないようにする）。 */}
      <MatchingPeerTabs counts={peerCounts} rightSlot={<MatchingPeriodChips />} />

      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Matching · 案件 × 人材（自動スコアリング）</div>
          <h1>マッチング</h1>
          <div className="sub">案件を選ぶと、スキル一致を主軸（単価・職種・リモートで補正）に候補をランキング表示します。</div>
        </div>
        {/* ヘッダの「LINEに送る」は廃止（マッチ結果カード内の LINEに送る＝雛形確認つき に集約。LINE WORKSボタンは使い方ガイド＋Web版を開く導線）。 */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
          <QuickAccessButtons canImport={scope.isInternal && gmailConfigured()} />
        </div>
      </div>

      <MatchingModeTabs />

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {opennessBanner}

      {/* 以下は案件を1件選んで候補を見る従来ツール（ドリルダウン用）。
          上部の「おすすめの組み合わせ TOP50」は全案件×全人材から全体最適で抽出（人材/案件は重複なし）。
          その下に、案件を1件選んで候補人材を絞り込む従来ビュー（左：ランキング／右：詳細）を表示する。 */}

      {/* 🔥 自動マッチング全体最適 TOP50（総合点数順・チェック選択→「提案する」で一括記録）。
          抽出条件は「マッチング自動ランキング条件定義書」準拠（src/lib/ranking100.ts）。
          メニューの「マッチング」を直接押した時（案件/人材を指定していない＝tab=autoの初期状態）のみ
          上部に表示する。個別の案件・人材から「マッチングボタン」で遷移した時（?job=… / ?person=…）
          は、絞り込み結果に集中できるよう非表示にする（要望対応）。 */}
      {autoMode && (
        <>
          {/* 担当者フィルタ（負荷軽減：選んだ担当者の人材だけをマッチング。選ぶまで計算しない） */}
          <MatchingAssigneePicker agents={assigneeCounts.agents} unassigned={assigneeCounts.unassigned} total={assigneeCounts.total} opColMissing={assigneeOpColMissing} />

          {!assigneeSelected ? (
            <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--color-ink-3)", fontSize: 13, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>担当者を選択してください</div>
              上の「担当者でしぼる」から担当者を1人以上（または「全員」）選ぶと、その担当の人材だけでマッチングを計算します。<br />
              負荷軽減のため、選択するまで全人材の読み込みは行いません。
            </div>
          ) : autoTop.rows.length > 0 ? (
            <Ranking100View
              rows={autoTop.rows}
              meta={{ jobsScanned: autoTop.jobsScanned, candsScanned: autoTop.candsScanned, pairsHit: autoTop.pairsHit }}
              title="🔥 おすすめの組み合わせ TOP50"
              subtitle={<>組み合わせを<b>高・中・低</b>の3ランクで表示。<b>高</b>＝定義書の絶対条件を確定データで全て満たす／<b>中</b>＝1〜2点の要確認あり／<b>低</b>＝要確認3点以上（要確認事項は各行を開くと確認できます）。致命的NG（提案不可・二社下以降・55歳以上・国籍NG・LINE/フリーランス由来・<b>提案済み</b>）は全ランクで除外。各ランク内は総合点数順・同じ人材/案件は重複しません。チェックで選択して<b>「提案する」</b>で一括記録できます。対象：案件 {autoTop.jobsScanned.toLocaleString("ja-JP")} 件 × 人材 {autoTop.candsScanned.toLocaleString("ja-JP")} 名・5分毎に更新。</>}
            />
          ) : (
            <div className="card" style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 13, marginBottom: 12 }}>
              選択した担当者の人材で、条件を満たす組み合わせが見つかりませんでした。別の担当者や「全員」を選ぶか、期間を広げてお試しください。
            </div>
          )}
        </>
      )}

      {/* 案件を指定せず TOP50 を見ているときは、下の「マッチング対象 案件」「人材ランキング」は表示しない。
          関係のない案件（先頭のjobList[0]）が出てしまう混乱を避けるための要望対応。 */}
      {(() => {
        const showAutoTop = autoMode;
        if (showAutoTop) return null;
        return (
          <>
            {selectedJobWarning(job)}
            {/* スキル未登録の案件はマッチング（スキル一致での人材ランキング）ができないため、0件の理由を明示する。 */}
            {job && !(job.skills?.length) && (
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", marginBottom: 12, background: "#fff6e0", border: "1px solid #fde9b0", color: "#92400e", fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>⚠ スキルが未登録です</span>
                <span>この案件は<b>スキルが登録されていない</b>ため、マッチング（スキル一致による人材ランキング）ができません。LINE取込などでスキルが抽出されていない場合に起こります。案件を編集してスキルを追加すると、ここに人材が表示されます。</span>
                <Link href={`/jobs?focus=${job.job_no}`} className="btn ghost btn-xs" style={{ marginLeft: "auto", textDecoration: "none", whiteSpace: "nowrap" }}>案件を編集してスキルを登録</Link>
              </div>
            )}
            {job && (
        <div className="match-side-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          {/* 左: ランキングリスト（AI再ランキング対応） */}
          <RankList jobAbbr={jobAbbr} jobNo={job.job_no} tab={tab} selCandNo={sel?.candidate.candidate_no} ranked={ranked} proposedCandIds={proposedCandIds} lineCandIds={lineCandIds} flCandIds={flCandIds}
            jobForAI={{ title: job.title, role_label: job.role_label, skills: job.skills, salary_min: job.salary_min, salary_max: job.salary_max, remote_type: job.remote_type, detail: job.detail }} />

          {/* 右: 詳細パネル */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* 対象案件 サマリ（スコア集計は団子になり情報量が無いので撤去。代わりに案件情報を厚く） */}
            <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 案件</span>
                <FocusHeart table="jobs" idField="job_no" idValue={job.job_no} initial={!!job.is_focus} revalidate="/matching" size={16} row={job} />
                <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)" }}>候補 {ranked.length}名</span>
              </div>
              {/* 案件名クリック＝外部共有ページのプレビュー（デザイン確認＋URLコピー）。社内ロールのみ。 */}
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--color-ink)" }}>{scope.isInternal ? (
                <ShareExternalButton kind="job" no={job.job_no}>
                  {job.title}
                  <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, color: "var(--color-brand-700)", marginLeft: 4, verticalAlign: "-2px" }}>ios_share</span>
                </ShareExternalButton>
              ) : job.title} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(job.job_no).padStart(5, "0")}</span></div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, color: "var(--color-ink-3)", flexWrap: "wrap", alignItems: "center" }}>
                <span>{job.client_name ?? "—"}</span>
                {job.role_label && <span className="tag">{job.role_label}</span>}
                <span className="tag">{remoteLabel(job.remote_type)}</span>
                {job.work_location && <span className="tag">{job.work_location}</span>}
                {job.flow_note && job.flow_note !== "不明" && <span className="tag">{displayFlowNote(job.flow_note)}</span>}
                {job.start_date && <span className="tag">稼働 {job.start_date}</span>}
                {/* 国籍要件・年齢制限は本文(detail+title)から判定。項目名は省き、他項目と同じ黒文字タグで表示。 */}
                {(() => { const n = classifyJobNationality(job.detail, job.title); return <span className="tag">{JOB_NAT_LABEL[n]}</span>; })()}
                {(() => { const a = classifyJobAge(job.detail, job.title); return <span className="tag">{a.label}</span>; })()}
                <b style={{ color: "var(--color-ink)" }}>{salaryLabel(job.salary_min, job.salary_max)}</b>
              </div>
              {job.skills?.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                  {job.skills.slice(0, 12).map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 10.5 }}>{s}</span>)}
                </div>
              )}
              {/* #260①：メール本文（detail）のプレビューは非表示（必須スキルの下に生の本文が出て見づらいため）。
                  本文は「元メールを開く」から確認できる。 */}
            </div>

            {/* #364：?cand= 指定なのに該当人材が見つからない場合の明示メッセージ（別人材は出さない）。 */}
            {sp.cand && !sel && (
              <div className="card" style={{ padding: 16, background: "#fff6e0", border: "1px solid #fde9b0", color: "#92400e", fontSize: 13 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ 指定の人材（P-{String(sp.cand).padStart(5, "0")}）が見つかりませんでした</div>
                削除・統合された、または人材NOが変更された可能性があります。提案レコードの人材を確認してください。
                （別の人材を誤って表示しないよう、ここでは候補を表示していません。）
              </div>
            )}

            {/* 選択候補 詳細 */}
            {sel && (() => {
              const c = sel.candidate;
              const rank = ranked.findIndex((r) => r.candidate.candidate_no === c.candidate_no) + 1;
              const skillPct = job.skills?.length ? Math.round((sel.matchedSkills.length / job.skills.length) * 100) : 0;
              return (
                <div className="card flush">
                  <div style={{ padding: "14px 20px", background: "#fffbeb", borderBottom: "1px solid #fde9b0", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>🏆 {rank}位（必須スキル {skillPct}%）</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {(() => { const v = verdictStyle(sel.verdict); return (<span style={{ fontWeight: 700, fontSize: 11.5, padding: "3px 10px", borderRadius: 99, background: v.bg, color: v.fg, border: `1px solid ${v.bd}` }}>{sel.verdict}</span>); })()}
                      <span className="tag brand" style={{ fontWeight: 700 }}>マッチ度 {sel.score}%</span>
                      {sel.flow && (() => {
                        const compat = sel.flow.compat as "ok" | "ng" | "unknown";
                        const t = FLOW_TONE[compat];
                        const title = compat === "ng"
                          ? `案件「${sel.flow.jobLabel}」／人材「${sel.flow.candLabel}」：マトリックスで不可`
                          : compat === "ok"
                            ? `案件「${sel.flow.jobLabel}」／人材「${sel.flow.candLabel}」`
                            : `案件「${sel.flow.jobLabel}」／人材「${sel.flow.candLabel}」（要確認）`;
                        return (
                          <span title={title} style={{ fontWeight: 700, fontSize: 11.5, padding: "3px 10px", borderRadius: 99, background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}>
                            {FLOW_LABEL[compat]}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                  <div style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <div className="ava lg" style={{ background: "var(--color-brand-50)" }}>{c.initials || c.name.slice(0, 2)}</div>
                      <div>
                        {/* #260②：人材IDの隣に登録元アイコン（LINE経由=LINEマーク／ENGERフリーランス=Eマーク）。 */}
                        <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {/* 人材名クリック＝外部共有ページのプレビュー（デザイン確認＋URLコピー）。社内ロールのみ。 */}
                          {scope.isInternal ? (
                            <ShareExternalButton kind="candidate" no={c.candidate_no}>
                              <span>{c.name}</span>
                              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, color: "var(--color-brand-700)", marginLeft: 4, verticalAlign: "-2px" }}>ios_share</span>
                            </ShareExternalButton>
                          ) : <span>{c.name}</span>}
                          <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
                          {lineCandIds.has(c.id) && <span title="LINE経由で登録された人材" style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={15} /></span>}
                          {flCandIds.has(c.id) && <span title="ENGERフリーランスで登録された人材" style={{ lineHeight: 0, display: "inline-flex" }}><Icons.engerFreelance size={15} /></span>}
                        </div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{[c.source_company || c.company, c.age_band, c.affiliation, candRemoteLabel(c.remote_pref), c.location, c.title].filter(Boolean).join(" / ")}</div>
                        <div style={{ fontSize: 11.5, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span>希望単価 <b style={{ color: "var(--color-ink)" }}>{c.rate ?? salaryLabel(c.salary_min, c.salary_max)}</b></span>
                          <span>国籍 <b style={{ color: "var(--color-ink)" }}>{CAND_NAT_LABEL[classifyCandNationality(c.nationality)]}</b></span>
                          {c.exp != null && String(c.exp).trim() !== "" && <span>経験年数 <b style={{ color: "var(--color-ink)" }}>{/^\d+$/.test(String(c.exp).trim()) ? `${String(c.exp).trim()}年` : c.exp}</b></span>}
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto" }}><FocusHeart table="candidates" idField="candidate_no" idValue={c.candidate_no} initial={!!c.is_focus} revalidate="/matching" size={18} row={c} /></div>
                    </div>

                    {/* 提案前チェック（確認ポイント）。決定論的 notes ＋ 任意でAIアドバイス。 */}
                    <MatchChecklist
                      notes={sel.notes}
                      jobNo={job?.job_no ?? null}
                      candNo={c?.candidate_no ?? null}
                      job={{ title: job?.title, skills: job?.skills, salary_label: salaryLabel(job?.salary_min, job?.salary_max), remote_type: remoteLabel(job?.remote_type), flow_note: job?.flow_note }}
                      cand={{ title: c.title, skills: c.skills, rate: c.rate ?? salaryLabel(c.salary_min, c.salary_max), nationality: CAND_NAT_LABEL[classifyCandNationality(c.nationality)], age_band: c.age_band, avail: c.avail, remote_pref: candRemoteLabel(c.remote_pref) }}
                      score={sel.score}
                      verdict={sel.verdict}
                    />

                    {/* 提案フォームを最上部に（すぐ送れるように） */}
                    <ProposalComposer key={`${job?.job_no}-${c?.candidate_no}`} job={job} cand={c} matchedSkills={sel.matchedSkills} missingSkills={sel.missingSkills} score={sel.score} lineTargets={lwTargets}
                      alreadyProposed={proposedCandIds.has(c.id)} proposalId={proposalIdByCand.get(c.id) ?? null}
                      proposedBy={proposalInfoByCand.get(c.id)?.proposer ?? null}
                      proposedAt={proposalInfoByCand.get(c.id)?.createdAt ?? null}
                      approvalStatus={proposalInfoByCand.get(c.id)?.approvalStatus ?? null}
                      members={proposerMembers}
                      shareJobNo={scope.isInternal ? (job?.job_no ?? null) : null}
                      shareCandNo={scope.isInternal ? (c.candidate_no ?? null) : null} />

                    {/* マッチ詳細はアコーディオンで折りたたみ（既定は閉。注意件数はサマリに出す） */}
                    {(() => {
                      const reds = sel.notes.filter((n: { level: string }) => n.level === "red").length;
                      const yels = sel.notes.filter((n: { level: string }) => n.level === "yellow").length;
                      return (
                        <details style={{ marginTop: 14, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
                          <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-2)" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-ink-4)" }}>expand_more</span>
                            📋 マッチ詳細（スキル評価・内訳・商流・注意点）
                            {reds > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: "#fdecef", color: "#b42318" }}>🔴 {reds}</span>}
                            {yels > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99, background: "#fff6e0", color: "#9a7b12" }}>🟡 {yels}</span>}
                          </summary>
                          {/* 左：スキル評価/商流・単価／右：注意点 (2カラム) */}
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start", marginTop: 12 }}>
                            <div>
                              <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>スキル評価</div>
                              {job.skills?.length ? (
                                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
                                  {sel.matchedSkills.map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 11 }}>✓ {s}</span>)}
                                  {sel.missingSkills.map((s: string) => <span key={s} className="tag" style={{ fontSize: 11, background: "transparent", border: "1px dashed var(--color-border-strong)", color: "var(--color-ink-4)" }}>未 {s}</span>)}
                                </div>
                              ) : <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>スキル評価データがありません</div>}

                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>💰 商流制限・単価</div>
                              <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.9 }}>
                                <div>商流制限：{job.flow_note && job.flow_note !== "不明" ? displayFlowNote(job.flow_note) : "確認中"}</div>
                                <div>単価：案件 {salaryLabel(job.salary_min, job.salary_max)} / 人材希望 {c.rate ?? salaryLabel(c.salary_min, c.salary_max)}</div>
                              </div>
                            </div>
                            <NotesPanel sel={sel} />
                          </div>
                        </details>
                      );
                    })()}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
          </>
        );
      })()}
    </div>
  );
}
