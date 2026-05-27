import Link from "next/link";
import { Icons } from "@/components/icons";
import { FocusHeart } from "@/components/FocusHeart";
import { ProposalComposer } from "@/components/ProposalComposer";
import { RankList } from "@/components/RankList";
import { FocusList } from "@/components/FocusList";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { rankCandidates, rankJobs, type Job } from "@/lib/match";

export const dynamic = "force-dynamic";

const remoteLabel = (r: string | null | undefined) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "—");
const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";

const ageDays = (d: any) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 9999);
const isProper = (a: any) => /\bPP\b|プロパー|自社/i.test(String(a || ""));

/**
 * 注力マッチングの対象を選定（定義）：
 *   ① ♡お気に入り(is_focus)  ② プロパー(PP)  ③ 最近(30日内)登録 かつ 決まりやすい(スキル有 or 提案可)
 *   注力スコアで並べ、上限60件に絞る（母数=300のような無意味な数を避ける）。
 */
function curateFocus(kind: "jobs" | "cands", rows: any[]): any[] {
  const seen = new Set<number>(); const out: any[] = [];
  for (const r of rows) {
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

export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ job?: string; tab?: string; cand?: string; person?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "focus" ? "focus" : "auto";
  const personNo = sp.person ? Number(sp.person) : null;

  let dbError: string | null = null;

  // 人材→案件モード用
  let person: any = null;
  let rankedJobs: any[] = [];

  // 案件→人材モード用
  let jobList: any[] = [];
  let job: any = null;
  let ranked: any[] = [];

  // 注力(ウォッチリスト)モード用
  let focusJobs: any[] = [];   // ♥お気に入り（手動・is_focus）
  let focusCands: any[] = [];
  let recoJobs: any[] = [];    // 自動おすすめ（プロパー/新着で決まりやすい・is_focus以外）
  let recoCands: any[] = [];

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const CAND_BASE = "candidate_no, name, initials, title, affiliation, source_company, age_band, skills, salary_min, salary_max, remote_pref, status, exp, rate, is_focus";
      const JOB_BASE = "job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, is_focus";

      if (personNo) {
        // ---- 人材 → 案件（逆マッチング）----
        const pr: any = await sb.from("candidates").select(`${CAND_BASE}, email, contact_email, skill_sheet_url`).eq("candidate_no", personNo).maybeSingle();
        person = pr.error ? (await sb.from("candidates").select(CAND_BASE).eq("candidate_no", personNo).maybeSingle()).data : pr.data;

        if (person?.skills?.length) {
          const buildJ = (cols: string) => {
            let q = sb.from("jobs").select(cols).eq("is_published", true).overlaps("skills", person.skills);
            if (tab === "focus") q = q.eq("is_focus", true);
            return q.limit(tab === "focus" ? 500 : 200);
          };
          let jr: any = await buildJ(`${JOB_BASE}, contact_email, contact_name, source_mail_url`);
          if (jr.error) jr = await buildJ(`${JOB_BASE}, contact_email, contact_name`);
          if (jr.error) jr = await buildJ(JOB_BASE);
          rankedJobs = rankJobs(person as any, (jr.data ?? []) as Job[], 10);
        }
      } else if (tab === "focus") {
        // ---- 注力 = ♥お気に入り（手動）／ 自動おすすめ = プロパー(PP)・新着で決まりやすい（is_focus以外）----
        const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const JOB_F = `${JOB_BASE}, status, created_at`;
        const CAND_F = `${CAND_BASE}, created_at`;
        const safe = async (q: any, fb: any) => { const r = await q; return r.error ? ((await fb)?.data ?? []) : (r.data ?? []); };
        const [hjJobs, recJobs, hfCands, ppCands, recCands] = await Promise.all([
          safe(sb.from("jobs").select(JOB_F).eq("is_published", true).eq("is_focus", true).limit(200), sb.from("jobs").select(JOB_BASE).eq("is_published", true).eq("is_focus", true).limit(200)),
          safe(sb.from("jobs").select(JOB_F).eq("is_published", true).gte("created_at", since30).limit(300), Promise.resolve({ data: [] })),
          safe(sb.from("candidates").select(CAND_F).eq("is_focus", true).limit(200), sb.from("candidates").select(CAND_BASE).eq("is_focus", true).limit(200)),
          safe(sb.from("candidates").select(CAND_F).or("affiliation.eq.PP,affiliation.ilike.%プロパー%").limit(300), Promise.resolve({ data: [] })),
          safe(sb.from("candidates").select(CAND_F).gte("created_at", since30).limit(400), Promise.resolve({ data: [] })),
        ]);
        // ♥お気に入り（手動）：ハートが点灯し、外すと件数が減る
        focusJobs = (hjJobs as any[]).slice(0, 100);
        focusCands = (hfCands as any[]).slice(0, 100);
        // 自動おすすめ：プロパー・新着で決まりやすい。is_focus は注力側に出すので除外
        recoJobs = curateFocus("jobs", recJobs).filter((j) => !j.is_focus).slice(0, 40);
        recoCands = curateFocus("cands", [...ppCands, ...recCands]).filter((c) => !c.is_focus).slice(0, 40);
      } else {
        // ---- 自動マッチング = 全データから合う候補をランキング（案件 → 人材）----
        const buildList = (cols: string) =>
          sb.from("jobs").select(cols).eq("is_published", true).neq("skills", "{}").order("job_no", { ascending: false }).limit(80);
        let jlRes: any = await buildList(`${JOB_BASE}, contact_email, contact_name, source_mail_url`);
        if (jlRes.error) jlRes = await buildList(`${JOB_BASE}, contact_email, contact_name`);
        if (jlRes.error) jlRes = await buildList(JOB_BASE);
        jobList = jlRes.data ?? [];

        const jobNo = sp.job ? Number(sp.job) : jobList[0]?.job_no;
        job = jobList.find((j) => j.job_no === jobNo) ?? jobList[0] ?? null;

        if (job?.skills?.length) {
          const buildC = (cols: string) => sb.from("candidates").select(cols).overlaps("skills", job.skills).limit(200);
          let cr: any = await buildC(`${CAND_BASE}, email, contact_email, skill_sheet_url`);
          if (cr.error) cr = await buildC(`${CAND_BASE}, email, contact_email`);
          if (cr.error) cr = await buildC(CAND_BASE);
          ranked = rankCandidates(job as Job, cr.data ?? [], 10);
        }
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else dbError = "Supabase の環境変数が未設定です";

  // ============ 人材 → 案件モードの描画 ============
  if (personNo) {
    const maxScore = rankedJobs[0]?.score ?? 0;
    const avgScore = rankedJobs.length ? Math.round(rankedJobs.reduce((a, r) => a + r.score, 0) / rankedJobs.length) : 0;
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

        {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

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
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</div>
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
              <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 人材</span>
                    <FocusHeart table="candidates" idField="candidate_no" idValue={person.candidate_no} initial={!!person.is_focus} revalidate="/matching" size={16} row={person} />
                  </div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--color-ink)" }}>{person.name} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(person.candidate_no).padStart(5, "0")}</span></div>
                  <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "var(--color-ink-3)", flexWrap: "wrap", alignItems: "center" }}>
                    {person.title && <span className="tag">{person.title}</span>}
                    {person.affiliation && <span className="tag">{person.affiliation}</span>}
                    <span className="tag">希望 {remoteLabel(person.remote_pref) === "—" ? (person.remote_pref ?? "—") : remoteLabel(person.remote_pref)}</span>
                    <b style={{ color: "var(--color-ink)" }}>{person.rate ?? salaryLabel(person.salary_min, person.salary_max)}</b>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 18, flexShrink: 0, textAlign: "center" }}>
                  <div><div className="display tnum" style={{ fontSize: 22, color: "var(--color-brand-700)" }}>{maxScore}%</div><div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>最高スコア</div></div>
                  <div><div className="display tnum" style={{ fontSize: 22, color: "var(--color-ink-2)" }}>{avgScore}%</div><div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>平均スコア</div></div>
                  <div><div className="display tnum" style={{ fontSize: 22, color: "var(--color-ink-2)" }}>{rankedJobs.length}</div><div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>候補案件</div></div>
                </div>
              </div>

              {sel && (() => {
                const j = sel.job;
                const rank = rankedJobs.findIndex((r) => r.job.job_no === j.job_no) + 1;
                const skillPct = j.skills?.length ? Math.round((sel.matchedSkills.length / j.skills.length) * 100) : 0;
                return (
                  <div className="card flush">
                    <div style={{ padding: "14px 20px", background: "#fffbeb", borderBottom: "1px solid #fde9b0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>🏆 {rank}位（要件スキル {skillPct}%）</div>
                      <span className="tag brand" style={{ fontWeight: 700 }}>マッチ度 {sel.score}%</span>
                    </div>
                    <div style={{ padding: 20 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{j.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>{[j.client_name, j.role_label, remoteLabel(j.remote_type), salaryLabel(j.salary_min, j.salary_max)].filter(Boolean).join(" / ")}</div>

                      <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>スキル評価</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
                        {sel.matchedSkills.map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 11 }}>✓ {s}</span>)}
                        {sel.missingSkills.map((s: string) => <span key={s} className="tag" style={{ fontSize: 11, background: "transparent", border: "1px dashed var(--color-border-strong)", color: "var(--color-ink-4)" }}>未 {s}</span>)}
                      </div>

                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>💡 マッチ理由</div>
                      <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.9 }}>
                        {sel.reasons.length ? sel.reasons.map((r: string, i: number) => <div key={i}>{r}</div>) : <span className="muted">—</span>}
                      </div>
                    </div>
                    <div style={{ padding: "14px 20px", borderTop: "1px solid var(--color-border)" }}>
                      <ProposalComposer job={j} cand={person} matchedSkills={sel.matchedSkills} missingSkills={sel.missingSkills} score={sel.score} />
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
    const Tabs = (
      <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {[{ id: "auto", label: "自動マッチング", note: "全案件・全人材" }, { id: "focus", label: "注力マッチング", note: "★ ♡・プロパー・新着" }].map((t) => {
          const active = t.id === (tab as string);
          return (
            <Link key={t.id} href={`/matching?tab=${t.id}`} style={{ padding: "8px 18px", borderRadius: 99, textDecoration: "none", background: active ? "var(--color-surface)" : "transparent", color: active ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 13, fontWeight: 600, boxShadow: active ? "0 1px 2px rgba(15,23,42,0.08)" : "none", display: "inline-flex", flexDirection: "column", lineHeight: 1.3 }}>
              {t.label}<span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>{t.note}</span>
            </Link>
          );
        })}
      </div>
    );
    return (
      <div className="page">
        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Matching · 注力（優先対応）</div>
            <h1>注力マッチング</h1>
            <div className="sub"><b>注力</b>＝<span style={{ color: "#e0567f" }}>♥</span>お気に入り（手動）。ハートを押すと注力に入り、外すと件数が減ります。<b>自動おすすめ</b>＝プロパー・新着で決まりやすい候補（♥を押すと注力に固定）。</div>
          </div>
        </div>
        {Tabs}
        {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

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
  const maxScore = ranked[0]?.score ?? 0;
  const avgScore = ranked.length ? Math.round(ranked.reduce((a, r) => a + r.score, 0) / ranked.length) : 0;
  const selIdx = sp.cand ? ranked.findIndex((r) => String(r.candidate.candidate_no) === sp.cand) : 0;
  const sel = ranked[selIdx >= 0 ? selIdx : 0];
  const jobAbbr = (job?.title ?? "").slice(0, 3);
  const linkFor = (cand?: number) => `/matching?tab=${tab}&job=${job?.job_no ?? ""}${cand != null ? `&cand=${cand}` : ""}`;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Matching · 案件 × 人材（自動スコアリング）</div>
          <h1>マッチング</h1>
          <div className="sub">案件を選ぶと、スキル一致を主軸（単価・職種・リモートで補正）に候補をランキング表示します。</div>
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <input type="hidden" name="tab" value={tab} />
          <select name="job" defaultValue={job?.job_no ?? ""} style={{ fontFamily: "inherit", fontSize: 12, padding: "8px 12px", borderRadius: 99, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", maxWidth: 340 }}>
            {jobList.map((j) => <option key={j.job_no} value={j.job_no}>No.{String(j.job_no).padStart(5, "0")} — {j.title.slice(0, 36)}</option>)}
          </select>
          <button className="btn brand" type="submit"><Icons.matching /><span>マッチ</span></button>
        </form>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {[{ id: "auto", label: "自動マッチング", note: "全案件・全人材" }, { id: "focus", label: "注力マッチング", note: "★ ♡・プロパー・新着" }].map((t) => {
          const active = t.id === (tab as string);
          return (
            <Link key={t.id} href={`/matching?tab=${t.id}`} style={{ padding: "8px 18px", borderRadius: 99, textDecoration: "none", background: active ? "var(--color-surface)" : "transparent", color: active ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 13, fontWeight: 600, boxShadow: active ? "0 1px 2px rgba(15,23,42,0.08)" : "none", display: "inline-flex", flexDirection: "column", lineHeight: 1.3 }}>
              {t.label}<span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>{t.note}</span>
            </Link>
          );
        })}
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {job && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          {/* 左: ランキングリスト（AI再ランキング対応） */}
          <RankList jobAbbr={jobAbbr} jobNo={job.job_no} tab={tab} selCandNo={sel?.candidate.candidate_no} ranked={ranked}
            jobForAI={{ title: job.title, role_label: job.role_label, skills: job.skills, salary_min: job.salary_min, salary_max: job.salary_max, remote_type: job.remote_type }} />

          {/* 右: 詳細パネル */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* 対象案件 サマリ */}
            <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 案件</span>
                  <FocusHeart table="jobs" idField="job_no" idValue={job.job_no} initial={!!job.is_focus} revalidate="/matching" size={16} row={job} />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--color-ink)" }}>{job.title}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "var(--color-ink-3)", flexWrap: "wrap", alignItems: "center" }}>
                  <span>{job.client_name ?? "—"}</span>
                  {job.role_label && <span className="tag">{job.role_label}</span>}
                  <span className="tag">{remoteLabel(job.remote_type)}</span>
                  {job.flow_note && job.flow_note !== "不明" && <span className="tag">{job.flow_note}</span>}
                  <b style={{ color: "var(--color-ink)" }}>{salaryLabel(job.salary_min, job.salary_max)}</b>
                </div>
              </div>
              <div style={{ display: "flex", gap: 18, flexShrink: 0, textAlign: "center" }}>
                <div><div className="display tnum" style={{ fontSize: 22, color: "var(--color-brand-700)" }}>{maxScore}%</div><div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>最高スコア</div></div>
                <div><div className="display tnum" style={{ fontSize: 22, color: "var(--color-ink-2)" }}>{avgScore}%</div><div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>平均スコア</div></div>
                <div><div className="display tnum" style={{ fontSize: 22, color: "var(--color-ink-2)" }}>{ranked.length}</div><div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>候補人材</div></div>
              </div>
            </div>

            {/* 選択候補 詳細 */}
            {sel && (() => {
              const c = sel.candidate;
              const rank = ranked.findIndex((r) => r.candidate.candidate_no === c.candidate_no) + 1;
              const skillPct = job.skills?.length ? Math.round((sel.matchedSkills.length / job.skills.length) * 100) : 0;
              return (
                <div className="card flush">
                  <div style={{ padding: "14px 20px", background: "#fffbeb", borderBottom: "1px solid #fde9b0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-ink)" }}>🏆 {rank}位（必須スキル {skillPct}%）</div>
                    <span className="tag brand" style={{ fontWeight: 700 }}>マッチ度 {sel.score}%</span>
                  </div>
                  <div style={{ padding: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <div className="ava lg" style={{ background: "var(--color-brand-50)" }}>{c.initials || c.name.slice(0, 2)}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(c.candidate_no).padStart(5, "0")}</span></div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{[c.source_company, c.age_band, c.affiliation, c.title].filter(Boolean).join(" / ")}</div>
                        <div style={{ fontSize: 11.5, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <span>希望単価 <b style={{ color: "var(--color-ink)" }}>{c.rate ?? salaryLabel(c.salary_min, c.salary_max)}</b></span>
                          {c.exp != null && String(c.exp).trim() !== "" && <span>経験年数 <b style={{ color: "var(--color-ink)" }}>{/^\d+$/.test(String(c.exp).trim()) ? `${String(c.exp).trim()}年` : c.exp}</b></span>}
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto" }}><FocusHeart table="candidates" idField="candidate_no" idValue={c.candidate_no} initial={!!c.is_focus} revalidate="/matching" size={18} row={c} /></div>
                    </div>

                    {/* スキル評価 */}
                    <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>スキル評価</div>
                    {job.skills?.length ? (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 16 }}>
                        {sel.matchedSkills.map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 11 }}>✓ {s}</span>)}
                        {sel.missingSkills.map((s: string) => <span key={s} className="tag" style={{ fontSize: 11, background: "transparent", border: "1px dashed var(--color-border-strong)", color: "var(--color-ink-4)" }}>未 {s}</span>)}
                      </div>
                    ) : <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>スキル評価データがありません</div>}

                    {/* 商流・利益 */}
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>💰 商流・単価</div>
                    <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.9, marginBottom: 16 }}>
                      <div>商流：{job.flow_note && job.flow_note !== "不明" ? job.flow_note : "確認中"}</div>
                      <div>単価：案件 {salaryLabel(job.salary_min, job.salary_max)} / 人材希望 {c.rate ?? salaryLabel(c.salary_min, c.salary_max)}
                        {" "}<span style={{ color: sel.reasons.some((r: string) => r.includes("予算内")) ? "var(--color-success)" : "var(--color-warn)" }}>
                          {sel.reasons.some((r: string) => r.includes("予算内")) ? "（予算内 ✓）" : "（要調整）"}
                        </span>
                      </div>
                    </div>

                    {/* 注意点 */}
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>⚠️ 注意点</div>
                    <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.8 }}>
                      {sel.missingSkills.length > 0 && <div>不足スキル：{sel.missingSkills.join("・")}</div>}
                      {!sel.reasons.some((r: string) => r.includes("予算内")) && <div>希望単価が案件予算と乖離の可能性</div>}
                      {sel.missingSkills.length === 0 && sel.reasons.some((r: string) => r.includes("予算内")) && <div className="muted">特筆すべき懸念はありません</div>}
                    </div>
                  </div>

                  {/* アクション: 返信メール（テンプレ/コピペ/AI生成） */}
                  <div style={{ padding: "14px 20px", borderTop: "1px solid var(--color-border)" }}>
                    <ProposalComposer job={job} cand={c} matchedSkills={sel.matchedSkills} missingSkills={sel.missingSkills} score={sel.score} />
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
