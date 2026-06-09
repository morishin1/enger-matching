import Link from "next/link";
import { Icons } from "@/components/icons";
import { FocusHeart } from "@/components/FocusHeart";
import { ProposalComposer } from "@/components/ProposalComposer";
import { RankList } from "@/components/RankList";
import { FocusList } from "@/components/FocusList";
import { NextStepLink } from "@/components/NextStepLink";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { rankCandidates, rankJobs, jobOpenness, JOB_STALE_DAYS, type Job, type MatchResult, type Verdict } from "@/lib/match";
import { FLOW_LABEL, FLOW_TONE, candDepthLabel, jobDepthLabel } from "@/lib/flow";
import { getBouncedSet, type BounceRecord } from "@/lib/bounces";
import { getViewerScope, maskJobs, maskCandidates } from "@/lib/tenant";
import { PartnerMatching } from "@/components/PartnerMatching";
import { ConfirmJobButton } from "@/components/ConfirmJobButton";
import { FlowSteps } from "@/components/FlowSteps";
import { MatchingPeerTabs } from "@/components/MatchingTabs";
import { MatchingModeTabs } from "@/components/MatchingModeTabs";
import { getSidebarCounts } from "@/lib/counts";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

const remoteLabel = (r: string | null | undefined) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "—");
const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";

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
    }
  } catch { /* noop */ }
}

/** パートナー企業向け：自社(owner_company)＋共有(shared)のみ取得して匿名化。
 *  既存マッチング画面のクエリは内部メールアドレス等を多数返すため、パートナーは別ビューで分離。 */
async function loadTenantData(company: string, meetingDone: boolean = true) {
  const sb = engerClient();
  const J = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, work_location, start_date, is_published, owner_company, shared";
  const C = "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, skills, salary_min, salary_max, remote_pref, status, exp, rate, avail, location, owner_company, shared";
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

export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ job?: string; tab?: string; cand?: string; person?: string; stale?: string }> }) {
  const sp = await searchParams;
  // 古い案件（配信から JOB_STALE_DAYS 超）を含めて表示するか。既定は false（隠す）。
  const showStale = sp.stale === "1";
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
  // 既定は自動マッチング（auto）。URL で tab=focus が明示された時のみ注力マッチング。
  const tab: "auto" | "focus" =
    sp.tab === "focus" ? "focus" : "auto";
  const personNo = sp.person ? Number(sp.person) : null;

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

  if (dbConfigured) {
    try {
      const sb = engerClient();
      // 注意：flow_depth / accept_flow_depth は supabase/flow-depth.sql 適用後のみ存在。
      //   SELECTに含めると未マイグレ環境で全体が落ちるため、CAND_BASE/JOB_BASE には含めず、
      //   呼出し側で「拡張SELECT → 失敗時は BASE」のフォールバックを掛ける（既存パターン踏襲）。
      const CAND_BASE = "id, candidate_no, name, initials, title, affiliation, source_company, company, age_band, skills, salary_min, salary_max, remote_pref, status, exp, rate, is_focus, avail, location, source_mail_url, note, created_at";
      const CAND_RICH = `${CAND_BASE}, email, contact_email, skill_sheet_url, skill_sheet_summary, flow_depth, deleted_at`;
      const JOB_BASE = "id, job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, is_focus, work_location, start_date, status, created_at";
      // 鮮度の最終確認日(last_confirmed_at)は移行後のみ存在。先頭で試し、無ければ created_at にフォールバック。
      const JOB_FRESH = `${JOB_BASE}, last_confirmed_at, accept_flow_depth, deleted_at`;

      // 充足（枠が埋まった）案件 = 稼働決定/稼働 の提案がある job_id。マッチングから自動除外する。
      const filledJobIds = new Set<string>();
      try {
        const fr: any = await sb.from("proposals").select("job_id, stage").in("stage", ["稼働決定", "稼働"]).limit(5000);
        for (const r of (fr.data ?? []) as any[]) if (r.job_id) filledJobIds.add(r.job_id);
      } catch { /* proposals 未整備でも続行（鮮度フィルタは効く） */ }

      // 送達不能アドレスのセット（bounce_records）。スコアリング前に各案件へ is_undeliverable を付与する。
      const bouncedMap = new Map<string, { count: number }>();
      try {
        const br: any = await sb.from("bounce_records").select("recipient_email, bounce_count").limit(10000);
        for (const row of (br.data ?? []) as any[]) bouncedMap.set(String(row.recipient_email ?? "").toLowerCase(), { count: row.bounce_count ?? 1 });
      } catch { /* bounce_records 未整備でも続行 */ }
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
          if (op.stale && !showStale) { staleHidden++; continue; } // 古い → 既定で隠す
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
          const buildJ = (cols: string) => {
            // 新着優先：job_no 降順（登録が新しい順）で取得。古い案件が上位に居座らないように。
            let q = sb.from("jobs").select(cols).eq("is_published", true).overlaps("skills", person.skills);
            if (tab === "focus") q = q.eq("is_focus", true);
            return q.order("job_no", { ascending: false }).limit(tab === "focus" ? 500 : 200);
          };
          let jr: any = await buildJ(`${JOB_FRESH}, contact_email, contact_name, source_mail_url`);
          if (jr.error) jr = await buildJ(`${JOB_BASE}, contact_email, contact_name, source_mail_url`);
          if (jr.error) jr = await buildJ(`${JOB_BASE}, contact_email, contact_name`);
          if (jr.error) jr = await buildJ(JOB_BASE);
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
          rankedJobs = rankJobs(person as any, (jobList as Job[]).filter((j: any) => !j?.deleted_at), 10);
        }
        // この人材が既に提案済みの案件（提案済み表示用）
        if (person?.id) {
          try { const { data } = await sb.from("proposals").select("id, job_id").eq("candidate_id", person.id); for (const r of (data ?? []) as any[]) { if (r.job_id) { proposedJobIds.add(r.job_id); proposalIdByJob.set(r.job_id, r.id); } } } catch { /* proposals未整備でも続行 */ }
        }
      } else if (tab === "focus") {
        // ---- 注力 = ♥お気に入り（手動）／ 自動おすすめ = プロパー(PP)・新着で決まりやすい（is_focus以外）----
        const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const JOB_F = JOB_BASE; // status, created_at は JOB_BASE に含む
        const CAND_F = `${CAND_BASE}, created_at`;
        const safe = async (q: any, fb: any) => { const r = await q; return r.error ? ((await fb)?.data ?? []) : (r.data ?? []); };
        const [hjJobs, recJobs, hfCands, ppCands, recCands] = await Promise.all([
          safe(sb.from("jobs").select(JOB_F).eq("is_published", true).eq("is_focus", true).limit(200), sb.from("jobs").select(JOB_BASE).eq("is_published", true).eq("is_focus", true).limit(200)),
          safe(sb.from("jobs").select(JOB_F).eq("is_published", true).gte("created_at", since30).limit(300), Promise.resolve({ data: [] })),
          safe(sb.from("candidates").select(CAND_F).eq("is_focus", true).limit(200), sb.from("candidates").select(CAND_BASE).eq("is_focus", true).limit(200)),
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
        const buildList = (cols: string) =>
          sb.from("jobs").select(cols).eq("is_published", true).neq("skills", "{}").order("job_no", { ascending: false }).limit(120);
        let jlRes: any = await buildList(`${JOB_FRESH}, contact_email, contact_name, source_mail_url`);
        if (jlRes.error) jlRes = await buildList(`${JOB_BASE}, contact_email, contact_name, source_mail_url`);
        if (jlRes.error) jlRes = await buildList(`${JOB_BASE}, contact_email, contact_name`);
        if (jlRes.error) jlRes = await buildList(JOB_BASE);
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
          // 新着優先：candidate_no 降順（＝登録が新しい順）で取得。古い候補が上位に居座る問題の対策。
          const buildC = (cols: string) => sb.from("candidates").select(cols).overlaps("skills", job.skills).order("candidate_no", { ascending: false }).limit(200);
          let cr: any = await buildC(CAND_RICH);
          if (cr.error) cr = await buildC(`${CAND_BASE}, email, contact_email, skill_sheet_url`);
          if (cr.error) cr = await buildC(`${CAND_BASE}, email, contact_email`);
          if (cr.error) cr = await buildC(CAND_BASE);
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
          ranked = rankCandidates(job as Job, candList.filter((c: any) => !c?.deleted_at), 10);
          // 指定された候補者が ranked(上位10)に入っていない場合は個別にスコア計算して先頭に挿入
          const reqCandNo2 = sp.cand ? Number(sp.cand) : null;
          if (reqCandNo2 && !ranked.find((r: any) => r.candidate.candidate_no === reqCandNo2)) {
            const tgt = candList.find((c) => c.candidate_no === reqCandNo2);
            if (tgt) {
              const single = rankCandidates(job as Job, [tgt], 1);
              if (single.length) ranked = [single[0], ...ranked];
            }
          }
        }
        // この案件で既に提案済みの人材（提案済み表示用）
        if (job?.id) {
          try { const { data } = await sb.from("proposals").select("id, candidate_id").eq("job_id", job.id); for (const r of (data ?? []) as any[]) { if (r.candidate_id) { proposedCandIds.add(r.candidate_id); proposalIdByCand.set(r.candidate_id, r.id); } } } catch { /* proposals未整備でも続行 */ }
        }
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else dbError = "Supabase の環境変数が未設定です";

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

  const opennessBanner = (hiddenFilledCount > 0 || hiddenStaleCount > 0 || showStale || undeliverableShown > 0) ? (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "10px 14px", marginBottom: 12, background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 12.5 }}>
      <span style={{ fontWeight: 700 }}>🛡 鮮度ガード</span>
      {hiddenFilledCount > 0 && <span style={{ color: "#b42318" }}>🔒 充足/終了 <b>{hiddenFilledCount}</b>件を除外</span>}
      {hiddenStaleCount > 0 && <span style={{ color: "#b45309" }}>🕓 配信{JOB_STALE_DAYS}日超の古い案件 <b>{hiddenStaleCount}</b>件を{showStale ? "表示中" : "非表示"}</span>}
      {showStale && hiddenStaleCount === 0 && <span style={{ color: "#b45309" }}>🕓 古い案件も表示中（在否確認のうえ提案を）</span>}
      {undeliverableShown > 0 && <span style={{ color: "#b42318" }}>📭 宛先が送達不能の案件 <b>{undeliverableShown}</b>件あり（提案前に連絡先確認）</span>}
      <Link href={buildToggleHref(!showStale)} className="btn ghost btn-xs" style={{ marginLeft: "auto", textDecoration: "none" }}>
        {showStale ? "古い案件を隠す" : "古い案件も表示する"}
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

  // ============ 人材 → 案件モードの描画 ============
  if (personNo) {
    const selJob = sp.job ? rankedJobs.find((r) => String(r.job.job_no) === sp.job) : rankedJobs[0];
    const sel = selJob ?? rankedJobs[0];
    const linkFor = (jno?: number) => `/matching?person=${personNo}&tab=${tab}${jno != null ? `&job=${jno}` : ""}`;

    return (
      <div className="page">
        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Matching · 人材 → 案件（AI分析）</div>
            <h1>{person?.name ?? "人材"} に合う案件</h1>
            <div className="sub">この人材のスキルを主軸に、単価・職種・リモート条件で補正して案件をランキング表示します。</div>
          </div>
          <Link href="/people" className="btn ghost" style={{ textDecoration: "none", flexShrink: 0 }}>← 人材一覧へ</Link>
        </div>

        <FlowSteps current="matching" sub="人材 → 案件" />
        <MatchingPeerTabs counts={peerCounts} />

        {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

        {opennessBanner}
        {selectedJobWarning(sel?.job)}

        {person && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
            {/* 左: 案件ランキング */}
            <div className="card flush" style={{ position: "sticky", top: 80 }}>
              <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>マッチ案件</div>
                <span className="tag brand">{rankedJobs.length}件</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rankedJobs.length === 0 ? (
                  <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>重なる案件がありません</div>
                ) : rankedJobs.map((r, i) => {
                  const j = r.job; const active = sel?.job.job_no === j.job_no;
                  const rankColor = i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : i === 2 ? "#cd853f" : "var(--color-surface-inset)";
                  return (
                    <Link key={j.job_no} href={linkFor(j.job_no)} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : "transparent" }}>
                      <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? rankColor : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</span>
                          <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400, flexShrink: 0 }}>No.{String(j.job_no).padStart(5, "0")}</span>
                          {proposedJobIds.has(j.id) && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#eef8f1", color: "#1aa260", border: "1px solid #bfe3cc", lineHeight: 1.5, flexShrink: 0 }}>記録済み</span>
                          )}
                        </div>
                        <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.client_name ?? "—"} · {salaryLabel(j.salary_min, j.salary_max)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: "var(--color-ink-4)" }}>相性</div><Stars score={r.score} /></div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* 右: 詳細 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 人材</span>
                  <FocusHeart table="candidates" idField="candidate_no" idValue={person.candidate_no} initial={!!person.is_focus} revalidate="/matching" size={16} row={person} />
                  <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)" }}>候補 {rankedJobs.length}件</span>
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--color-ink)" }}>{person.name} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(person.candidate_no).padStart(5, "0")}</span></div>
                <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, color: "var(--color-ink-3)", flexWrap: "wrap", alignItems: "center" }}>
                  {person.title && <span className="tag">{person.title}</span>}
                  {(person.source_company || person.company) && <span className="tag">{person.source_company || person.company}</span>}
                  {person.affiliation && <span className="tag">{person.affiliation}</span>}
                  <span className="tag">希望 {remoteLabel(person.remote_pref) === "—" ? (person.remote_pref ?? "—") : remoteLabel(person.remote_pref)}</span>
                  <span className="tag">{person.location ?? "勤務地不明"}</span>
                  {person.exp != null && String(person.exp).trim() !== "" && <span className="tag">経験 {/^\d+$/.test(String(person.exp).trim()) ? `${String(person.exp).trim()}年` : person.exp}</span>}
                  {person.avail && <span className="tag">稼働 {person.avail}</span>}
                  <b style={{ color: "var(--color-ink)" }}>{person.rate ?? salaryLabel(person.salary_min, person.salary_max)}</b>
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
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{j.title} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(j.job_no).padStart(5, "0")}</span></div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{[j.client_name, j.role_label, remoteLabel(j.remote_type), j.work_location, salaryLabel(j.salary_min, j.salary_max)].filter(Boolean).join(" / ")}</div>

                      {/* 提案フォームを最上部に（すぐ送れるように） */}
                      <ProposalComposer key={`${j.job_no}-${person?.candidate_no}`} job={j} cand={person} matchedSkills={sel.matchedSkills} missingSkills={sel.missingSkills} score={sel.score} alreadyProposed={proposedJobIds.has(j.id)} proposalId={proposalIdByJob.get(j.id) ?? null} members={proposerMembers} />

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
                            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start", marginTop: 12 }}>
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
  if (tab === "focus") {
    return (
      <div className="page">
        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Matching · 注力（優先対応）</div>
            <h1>注力マッチング</h1>
            <div className="sub"><b>注力</b>＝<span style={{ color: "#e0567f" }}>♥</span>お気に入り（手動）。ハートを押すと注力に入り、外すと件数が減ります。<b>自動おすすめ</b>＝プロパー・新着で決まりやすい候補（♥を押すと注力に固定）。</div>
          </div>
        </div>
        <FlowSteps current="matching" sub="注力" />
        <MatchingPeerTabs counts={peerCounts} />
        <MatchingModeTabs />
        {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
        {opennessBanner}

        {/* 注力（♥お気に入り・手動）：ハートを外すと即座に件数・行が減る */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
          <FocusList kind="jobs" items={focusJobs} unit="件" removeOnUnheart
            headerTitle={<><span style={{ color: "#e0567f" }}>♥</span> 注力案件</>}
            emptyText={<>案件一覧やマッチングで <span style={{ color: "#e0567f" }}>♥</span> を押すとここに表示されます</>} />
          <FocusList kind="people" items={focusCands} unit="名" removeOnUnheart
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
              {recoJobs.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>新着の決まりやすい案件はありません</div> : <FocusList kind="jobs" items={recoJobs} />}
            </div>
            <div className="card flush">
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>💡 自動おすすめ人材</div><span className="tag">{recoCands.length}名</span>
              </div>
              {recoCands.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>プロパー・新着の決まりやすい人材はありません</div> : <FocusList kind="people" items={recoCands} />}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ 案件 → 人材モードの描画 ============
  const selIdx = sp.cand ? ranked.findIndex((r) => String(r.candidate.candidate_no) === sp.cand) : 0;
  const sel = ranked[selIdx >= 0 ? selIdx : 0];
  const jobAbbr = (job?.title ?? "").slice(0, 3);
  const linkFor = (cand?: number) => `/matching?tab=${tab}&job=${job?.job_no ?? ""}${cand != null ? `&cand=${cand}` : ""}`;

  return (
    <div className="page">
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Matching · 案件 × 人材（自動スコアリング）</div>
          <h1>マッチング</h1>
          <div className="sub">案件を選ぶと、スキル一致を主軸（単価・職種・リモートで補正）に候補をランキング表示します。</div>
        </div>
        <NextStepLink href="/proposals" label="提案管理を見る" hint="マッチングからの提案を一覧で管理" />
        <form style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <input type="hidden" name="tab" value={tab} />
          <select name="job" defaultValue={job?.job_no ?? ""} style={{ fontFamily: "inherit", fontSize: 12, padding: "8px 12px", borderRadius: 99, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", maxWidth: 340 }}>
            {jobList.map((j) => <option key={j.job_no} value={j.job_no}>No.{String(j.job_no).padStart(5, "0")} — {j.title.slice(0, 36)}</option>)}
          </select>
          <button className="btn brand" type="submit"><Icons.matching /><span>マッチ</span></button>
        </form>
      </div>

      <FlowSteps current="matching" sub="案件 → 人材" />

      <MatchingPeerTabs counts={peerCounts} />

      <MatchingModeTabs />

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {opennessBanner}
      {selectedJobWarning(job)}

      {job && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          {/* 左: ランキングリスト（AI再ランキング対応） */}
          <RankList jobAbbr={jobAbbr} jobNo={job.job_no} tab={tab} selCandNo={sel?.candidate.candidate_no} ranked={ranked} proposedCandIds={proposedCandIds}
            jobForAI={{ title: job.title, role_label: job.role_label, skills: job.skills, salary_min: job.salary_min, salary_max: job.salary_max, remote_type: job.remote_type }} />

          {/* 右: 詳細パネル */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* 対象案件 サマリ（スコア集計は団子になり情報量が無いので撤去。代わりに案件情報を厚く） */}
            <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 案件</span>
                <FocusHeart table="jobs" idField="job_no" idValue={job.job_no} initial={!!job.is_focus} revalidate="/matching" size={16} row={job} />
                <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)" }}>候補 {ranked.length}名</span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--color-ink)" }}>{job.title} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(job.job_no).padStart(5, "0")}</span></div>
              <div style={{ display: "flex", gap: 10, marginTop: 6, fontSize: 12, color: "var(--color-ink-3)", flexWrap: "wrap", alignItems: "center" }}>
                <span>{job.client_name ?? "—"}</span>
                {job.role_label && <span className="tag">{job.role_label}</span>}
                <span className="tag">{remoteLabel(job.remote_type)}</span>
                {job.work_location && <span className="tag">{job.work_location}</span>}
                {job.flow_note && job.flow_note !== "不明" && <span className="tag">{job.flow_note}</span>}
                {job.start_date && <span className="tag">稼働 {job.start_date}</span>}
                <b style={{ color: "var(--color-ink)" }}>{salaryLabel(job.salary_min, job.salary_max)}</b>
              </div>
              {job.skills?.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                  {job.skills.slice(0, 12).map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 10.5 }}>{s}</span>)}
                </div>
              )}
              {job.detail && (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{job.detail}</div>
              )}
            </div>

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
                          ? `案件「${jobDepthLabel(sel.flow.jobMaxDepth)}」／候補「${candDepthLabel(sel.flow.candDepth)}」：受入上限を超過`
                          : compat === "ok"
                            ? `案件「${jobDepthLabel(sel.flow.jobMaxDepth)}」／候補「${candDepthLabel(sel.flow.candDepth)}」`
                            : `案件「${jobDepthLabel(sel.flow.jobMaxDepth)}」／候補「${candDepthLabel(sel.flow.candDepth)}」（要確認）`;
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
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(c.candidate_no).padStart(5, "0")}</span></div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{[c.source_company || c.company, c.age_band, c.affiliation, remoteLabel(c.remote_pref), c.location, c.title].filter(Boolean).join(" / ")}</div>
                        <div style={{ fontSize: 11.5, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span>希望単価 <b style={{ color: "var(--color-ink)" }}>{c.rate ?? salaryLabel(c.salary_min, c.salary_max)}</b></span>
                          {c.exp != null && String(c.exp).trim() !== "" && <span>経験年数 <b style={{ color: "var(--color-ink)" }}>{/^\d+$/.test(String(c.exp).trim()) ? `${String(c.exp).trim()}年` : c.exp}</b></span>}
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto" }}><FocusHeart table="candidates" idField="candidate_no" idValue={c.candidate_no} initial={!!c.is_focus} revalidate="/matching" size={18} row={c} /></div>
                    </div>

                    {/* 提案フォームを最上部に（すぐ送れるように） */}
                    <ProposalComposer key={`${job?.job_no}-${c?.candidate_no}`} job={job} cand={c} matchedSkills={sel.matchedSkills} missingSkills={sel.missingSkills} score={sel.score} alreadyProposed={proposedCandIds.has(c.id)} proposalId={proposalIdByCand.get(c.id) ?? null} members={proposerMembers} />

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

                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>💰 商流・単価</div>
                              <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.9 }}>
                                <div>商流：{job.flow_note && job.flow_note !== "不明" ? job.flow_note : "確認中"}</div>
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
    </div>
  );
}
