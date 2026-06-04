"use client";

// パートナー企業向けの軽量マッチング画面（クライアント側）。
// サーバから受け取るのは「自社＋共有」のみで、他社は既に匿名化(_anon=true)済み。
// 提案ボタン・メール生成・元メール参照は一切表示しない（漏洩防止）。
import { useMemo, useState } from "react";
import { rankCandidates, rankJobs } from "@/lib/match";

type Job = any;
type Cand = any;

const remoteLabel = (r?: string | null) => r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "—");
const salaryLabel = (lo?: number | null, hi?: number | null) => lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";

function Stars({ score }: { score: number }) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return <span style={{ color: "#f0a92b", letterSpacing: 1, fontSize: 13 }}>{"★".repeat(n)}<span style={{ color: "var(--color-ink-5)" }}>{"★".repeat(5 - n)}</span></span>;
}

const AnonBadge = ({ on }: { on?: boolean }) => on ? <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#eef2ff", color: "#3730a3", border: "1px solid #c7d2fe" }}>共有・匿名</span> : null;
const OwnBadge = ({ on }: { on?: boolean }) => on ? <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc" }}>自社</span> : null;

export function PartnerMatching({ jobs, candidates }: { jobs: Job[]; candidates: Cand[] }) {
  const [mode, setMode] = useState<"job" | "cand">("job");
  const [selJob, setSelJob] = useState<number | null>(jobs[0]?.job_no ?? null);
  const [selCand, setSelCand] = useState<number | null>(candidates[0]?.candidate_no ?? null);

  const job = useMemo(() => jobs.find((j) => j.job_no === selJob) ?? null, [jobs, selJob]);
  const cand = useMemo(() => candidates.find((c) => c.candidate_no === selCand) ?? null, [candidates, selCand]);

  const rankedCands = useMemo(() => job ? rankCandidates(job, candidates, 30) : [], [job, candidates]);
  const rankedJobs = useMemo(() => cand ? rankJobs(cand, jobs, 30) : [], [cand, jobs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={{ background: "#eef2ff", borderColor: "#c7d2fe", fontSize: 12.5, color: "var(--color-ink-2)" }}>
        <b>マッチング</b>：あなたが登録した（自社の）案件・人材と、共有された案件・人材で相性を表示します。<b>他社のクライアント名・氏名・連絡先は伏せた匿名表示</b>です。提案・メール作成は本画面では行えません（社内担当へご連絡ください）。
      </div>

      {/* モード切替 */}
      <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {([["job", "案件 → 人材"], ["cand", "人材 → 案件"]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setMode(v)}
            style={{ padding: "6px 14px", borderRadius: 99, border: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
              background: mode === v ? "var(--color-surface)" : "transparent", color: mode === v ? "var(--color-ink)" : "var(--color-ink-3)",
              boxShadow: mode === v ? "0 1px 2px rgba(15,23,42,.1)" : "none" }}>{label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 16 }}>
        {/* 左：起点の一覧 */}
        <div className="card flush" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {mode === "job" ? (
            jobs.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>表示できる案件がありません</div>
              : jobs.map((j) => {
                const active = j.job_no === selJob;
                return (
                  <button key={j.job_no} type="button" onClick={() => setSelJob(j.job_no)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", border: 0, borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : "transparent", cursor: "pointer", fontFamily: "inherit" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>{j.title}</span>
                      <OwnBadge on={!j._anon} /><AnonBadge on={!!j._anon} />
                    </div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{j._anon ? "（匿名）" : (j.client_name ?? "—")} · {salaryLabel(j.salary_min, j.salary_max)}</div>
                  </button>
                );
              })
          ) : (
            candidates.length === 0 ? <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>表示できる人材がいません</div>
              : candidates.map((c) => {
                const active = c.candidate_no === selCand;
                return (
                  <button key={c.candidate_no} type="button" onClick={() => setSelCand(c.candidate_no)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", border: 0, borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : "transparent", cursor: "pointer", fontFamily: "inherit" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>{c.name}</span>
                      <OwnBadge on={!c._anon} /><AnonBadge on={!!c._anon} />
                    </div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{c.title ?? "—"} · {c.rate ?? salaryLabel(c.salary_min, c.salary_max)}</div>
                  </button>
                );
              })
          )}
        </div>

        {/* 右：ランキング */}
        <div className="card flush">
          {mode === "job" && job && (
            <>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {job.title} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(job.job_no).padStart(5, "0")}</span>
                  <OwnBadge on={!job._anon} /><AnonBadge on={!!job._anon} />
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{job._anon ? "（クライアント名は非表示）" : (job.client_name ?? "")} · {salaryLabel(job.salary_min, job.salary_max)} · {remoteLabel(job.remote_type)}</div>
              </div>
              {rankedCands.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>マッチする人材がいません</div>
                : rankedCands.map((r, i) => {
                  const c: any = r.candidate;
                  return (
                  <div key={c.candidate_no} style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? (i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : "#cd853f") : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{c.name}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
                        <OwnBadge on={!c._anon} /><AnonBadge on={!!c._anon} />
                      </div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{[c.title, c.rate, r.matchedSkills.slice(0, 4).join(" / ")].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: "var(--color-ink-4)" }}>相性</div><Stars score={r.score} /></div>
                  </div>
                  );
                })}
            </>
          )}
          {mode === "cand" && cand && (
            <>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {cand.name} <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(cand.candidate_no).padStart(5, "0")}</span>
                  <OwnBadge on={!cand._anon} /><AnonBadge on={!!cand._anon} />
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{cand.title ?? "—"} · {cand.rate ?? salaryLabel(cand.salary_min, cand.salary_max)} · {remoteLabel(cand.remote_pref)}</div>
              </div>
              {rankedJobs.length === 0 ? <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>マッチする案件がありません</div>
                : rankedJobs.map((r, i) => {
                  const j: any = r.job;
                  return (
                  <div key={j.job_no} style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? (i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : "#cd853f") : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{j.title}</span>
                        <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(j.job_no).padStart(5, "0")}</span>
                        <OwnBadge on={!j._anon} /><AnonBadge on={!!j._anon} />
                      </div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{[j._anon ? "（匿名）" : j.client_name, salaryLabel(j.salary_min, j.salary_max), r.matchedSkills.slice(0, 4).join(" / ")].filter(Boolean).join(" · ")}</div>
                    </div>
                    <div style={{ textAlign: "right" }}><div style={{ fontSize: 9, color: "var(--color-ink-4)" }}>相性</div><Stars score={r.score} /></div>
                  </div>
                  );
                })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
