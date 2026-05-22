import Link from "next/link";
import { Icons } from "@/components/icons";
import { FocusHeart } from "@/components/FocusHeart";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { rankCandidates, type Job } from "@/lib/match";

export const dynamic = "force-dynamic";

const remoteLabel = (r: string | null | undefined) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "—");
const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";

function Stars({ score }: { score: number }) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return (
    <span style={{ color: "#f0a92b", letterSpacing: 1, fontSize: 13 }}>
      {"★".repeat(n)}<span style={{ color: "var(--color-ink-5)" }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ job?: string; tab?: string; cand?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "focus" ? "focus" : "auto";
  let jobList: any[] = [];
  let job: any = null;
  let ranked: any[] = [];
  let focusJobCount = 0, focusPeopleCount = 0;
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      let jq = sb.from("jobs")
        .select("job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name, flow_note, detail, is_focus")
        .eq("is_published", true).neq("skills", "{}");
      if (tab === "focus") jq = jq.eq("is_focus", true);

      // 独立クエリを並列実行 (注力件数 × 2 + 案件リスト)
      const [fj, fp, jlRes] = await Promise.all([
        sb.from("jobs").select("job_no", { count: "exact", head: true }).eq("is_focus", true),
        sb.from("candidates").select("candidate_no", { count: "exact", head: true }).eq("is_focus", true),
        jq.order("job_no", { ascending: false }).limit(80),
      ]);
      focusJobCount = fj.count ?? 0; focusPeopleCount = fp.count ?? 0;
      jobList = jlRes.data ?? [];

      const jobNo = sp.job ? Number(sp.job) : jobList[0]?.job_no;
      job = jobList.find((j) => j.job_no === jobNo) ?? jobList[0] ?? null;

      if (job?.skills?.length) {
        let cq = sb.from("candidates")
          .select("candidate_no, name, initials, title, affiliation, source_company, age_band, skills, salary_min, salary_max, remote_pref, status, exp, rate, is_focus")
          .overlaps("skills", job.skills);
        if (tab === "focus") cq = cq.eq("is_focus", true);
        const { data: pool } = await cq.limit(tab === "focus" ? 500 : 200);
        ranked = rankCandidates(job as Job, pool ?? [], 10);
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else dbError = "Supabase の環境変数が未設定です";

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
        {[{ id: "auto", label: "自動マッチング", note: "全案件・全人材" }, { id: "focus", label: "注力マッチング", note: `★ ${focusJobCount}案件 × ${focusPeopleCount}人材` }].map((t) => {
          const active = tab === t.id;
          return (
            <Link key={t.id} href={`/matching?tab=${t.id}`} style={{ padding: "8px 18px", borderRadius: 99, textDecoration: "none", background: active ? "var(--color-surface)" : "transparent", color: active ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 13, fontWeight: 600, boxShadow: active ? "0 1px 2px rgba(15,23,42,0.08)" : "none", display: "inline-flex", flexDirection: "column", lineHeight: 1.3 }}>
              {t.label}<span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>{t.note}</span>
            </Link>
          );
        })}
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {tab === "focus" && jobList.length === 0 && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>注力案件がありません。案件・人材ページで <span style={{ color: "#e0567f" }}>♥</span> を押すと注力に登録され、ここでマッチングできます。</div>
      )}

      {job && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          {/* 左: ランキングリスト */}
          <div className="card flush" style={{ position: "sticky", top: 80 }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{jobAbbr} のマッチング人材</div>
              <span className="tag brand">{ranked.length}件</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {ranked.length === 0 ? (
                <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>重なる人材がいません</div>
              ) : ranked.map((r, i) => {
                const c = r.candidate;
                const active = (sel?.candidate.candidate_no === c.candidate_no);
                const rankColor = i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : i === 2 ? "#cd853f" : "var(--color-surface-inset)";
                return (
                  <Link key={c.candidate_no} href={linkFor(c.candidate_no)} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : "transparent" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? rankColor : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)" }}>{jobAbbr} ↔ {c.name}</div>
                      <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title ?? "—"} · {c.affiliation ?? c.source_company ?? ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 9, color: "var(--color-ink-4)" }}>相性</div>
                      <Stars score={r.score} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* 右: 詳細パネル */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* 対象案件 サマリ */}
            <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--color-brand-700)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>マッチング対象 案件</span>
                  <FocusHeart table="jobs" idField="job_no" idValue={job.job_no} initial={!!job.is_focus} revalidate="/matching" size={16} />
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
                        <div className="muted" style={{ fontSize: 11.5 }}>{[c.source_company, c.age_band, c.affiliation, c.rate, c.title].filter(Boolean).join(" / ")}</div>
                      </div>
                      <div style={{ marginLeft: "auto" }}><FocusHeart table="candidates" idField="candidate_no" idValue={c.candidate_no} initial={!!c.is_focus} revalidate="/matching" size={18} /></div>
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

                  {/* アクション */}
                  <div style={{ padding: "14px 20px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="btn brand" style={{ flex: 1, justifyContent: "center" }}><Icons.arrow /><span>このペアで提案する</span></button>
                    <Link href={linkFor(ranked[Math.min(rank, ranked.length - 1)]?.candidate.candidate_no)} className="btn ghost" style={{ textDecoration: "none" }}>スキップ</Link>
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
