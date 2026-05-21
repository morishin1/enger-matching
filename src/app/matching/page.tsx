import { Icons } from "@/components/icons";
import { engerClient, dbConfigured } from "@/lib/supabase";
import { rankCandidates, type Job } from "@/lib/match";

export const dynamic = "force-dynamic";

const remoteLabel = (r: string | null | undefined) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");
const salaryLabel = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "スキル見合い";

function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const inner = size - 12;
  const color = score >= 80 ? "var(--color-brand-700)" : score >= 60 ? "var(--color-brand-500)" : score >= 40 ? "var(--color-brand-400)" : "var(--color-ink-4)";
  return (
    <div style={{ width: size, height: size, borderRadius: 99, flex: `0 0 ${size}px`, background: `conic-gradient(${color} ${score}%, var(--color-brand-50) 0)`, display: "grid", placeItems: "center" }}>
      <div style={{ width: inner, height: inner, borderRadius: 99, background: "var(--color-surface)", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: size > 40 ? 15 : 12, fontVariantNumeric: "tabular-nums", color: "var(--color-ink)" }}>{score}</div>
    </div>
  );
}

export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const sp = await searchParams;
  let jobList: any[] = [];
  let job: Job | null = null;
  let ranked: any[] = [];
  let dbError: string | null = null;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data: jl } = await sb
        .from("jobs")
        .select("job_no, title, role_label, skills, salary_min, salary_max, remote_type, client_name")
        .eq("is_published", true)
        .neq("skills", "{}")
        .order("job_no", { ascending: false })
        .limit(80);
      jobList = jl ?? [];
      const jobNo = sp.job ? Number(sp.job) : jobList[0]?.job_no;
      job = jobList.find((j) => j.job_no === jobNo) ?? jobList[0] ?? null;

      if (job?.skills?.length) {
        const { data: pool } = await sb
          .from("candidates")
          .select("candidate_no, name, initials, title, skills, salary_min, salary_max, remote_pref, status, exp, rate")
          .overlaps("skills", job.skills)
          .limit(200);
        ranked = rankCandidates(job, pool ?? [], 30);
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const top = ranked.filter((r) => r.score >= 70).length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Matching · 案件 × 人材（実データ・自動スコアリング）</div>
          <h1>マッチング</h1>
          <div className="sub">
            選択した案件に対し、<b className="mono">enger.candidates</b> から
            スキル一致を主軸（単価・職種・リモートで補正）に <b style={{ color: "var(--color-ink)" }}>{ranked.length} 名</b> をスコアリング。
            スコア 70+ は <b style={{ color: "var(--color-brand-700)" }}>{top} 名</b>。
          </div>
        </div>
        <form style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <select name="job" defaultValue={job?.job_no ?? ""} style={{ fontFamily: "inherit", fontSize: 12, padding: "8px 12px", borderRadius: 99, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", maxWidth: 360 }}>
            {jobList.map((j) => (
              <option key={j.job_no} value={j.job_no}>No.{String(j.job_no).padStart(5, "0")} — {j.title.slice(0, 40)}</option>
            ))}
          </select>
          <button className="btn brand" type="submit"><Icons.matching /><span>マッチ</span></button>
        </form>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {/* 対象案件カード */}
      {job && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-200)", borderLeftWidth: 3, borderLeftColor: "var(--color-brand-700)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-3)" }}>No.{String(job.job_no).padStart(5, "0")}</span>
                <span className="pill open">募集中</span>
              </div>
              <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, color: "var(--color-ink)" }}>{job.title}</h2>
              <div style={{ display: "flex", gap: 18, marginTop: 8, color: "var(--color-ink-3)", fontSize: 12.5, flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.building />{(job as any).client_name ?? "—"}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.yen />{salaryLabel(job.salary_min, job.salary_max)}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.loc />{remoteLabel(job.remote_type)}</span>
                {job.role_label && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icons.user />{job.role_label}</span>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(job.skills ?? []).map((s) => <span key={s} className="tag brand">{s}</span>)}
          </div>
        </div>
      )}

      {/* スコア順 候補リスト */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ranked.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
            この案件のスキルに重なる人材が見つかりません（人材CSVを取り込むと候補が増えます）。
          </div>
        ) : (
          ranked.map(({ candidate: c, score, matchedSkills, missingSkills, reasons }) => (
            <div key={c.candidate_no} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, padding: 14, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <ScoreRing score={score} />
                <div className="ava lg" style={{ background: "var(--color-brand-50)" }}>{c.initials || (c.name ?? "?").slice(0, 2)}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, color: "var(--color-ink)" }}>{c.name}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>P-{String(c.candidate_no ?? 0).padStart(5, "0")}</span>
                  <span className="pill" style={{ marginLeft: 4 }}>{c.status}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{c.title ?? "—"}</div>
                <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 11.5, color: "var(--color-ink-3)" }}>
                  <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.yen />{c.rate ?? salaryLabel(c.salary_min, c.salary_max)}</span>
                  {c.exp && <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.user />{c.exp}</span>}
                  {c.remote_pref && <span style={{ display: "flex", gap: 4, alignItems: "center" }}><Icons.loc />{c.remote_pref}</span>}
                </div>
                <div style={{ display: "flex", gap: 5, marginTop: 8, flexWrap: "wrap" }}>
                  {matchedSkills.slice(0, 6).map((s: string) => <span key={s} className="tag brand" style={{ fontSize: 10.5 }}>{s}</span>)}
                  {missingSkills.slice(0, 3).map((s: string) => <span key={s} className="tag" style={{ fontSize: 10.5, background: "transparent", border: "1px dashed var(--color-border-strong)", color: "var(--color-ink-4)" }}>未: {s}</span>)}
                </div>
              </div>
              <div style={{ width: 230, borderLeft: "1px solid var(--color-border)", paddingLeft: 14, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 500 }}>マッチ根拠</div>
                {reasons.slice(0, 4).map((r: string, i: number) => (
                  <div key={i} style={{ fontSize: 11.5, color: "var(--color-ink-2)", lineHeight: 1.5 }}>{r}</div>
                ))}
                <button className="btn brand" style={{ marginTop: 6, justifyContent: "center", padding: "6px 10px", fontSize: 12 }}>提案を作成</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
