"use client";

// 人材 → 案件モードの「マッチ案件」リスト（AI再ランキング対応）。
//   案件 → 人材側の RankList と対になるコンポーネント。
//   上位10件の案件を AI が人材視点で文脈評価して並べ替える（/api/match-rerank-jobs）。

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { classifyJobNationality, JOB_NAT_LABEL, classifyJobAge } from "@/lib/nationality";

function Stars({ score }: { score: number }) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return <span style={{ color: "#f0a92b", letterSpacing: 1, fontSize: 13 }}>{"★".repeat(n)}<span style={{ color: "var(--color-ink-5)" }}>{"★".repeat(5 - n)}</span></span>;
}

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `${lo}万円` : `${lo}〜${hi}万円`) : hi ? `〜${hi}万円` : lo ? `${lo}万円〜` : "スキル見合い";
const remoteLabel = (r?: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社必須" : (r || "リモート不明");

type RankedJob = { job: any; score: number };

// AI再ランキング結果と表示モードを人材単位で永続化（再訪時にタブ切替で復元）。
const AI_STORE_KEY = (personNo: number) => `enger.match.aijobs.v1.${personNo}`;
const VIEW_STORE_KEY = (personNo: number) => `enger.match.viewjobs.v1.${personNo}`;

export function RankJobList({ personNo, tab, selJobNo, ranked, proposedJobIds, candForAI }: {
  personNo: number; tab: string; selJobNo?: number; ranked: RankedJob[]; proposedJobIds?: Set<string>; candForAI: any;
}) {
  const [ai, setAi] = useState<Map<number, { score: number; reason: string }> | null>(null);
  const [view, setView] = useState<"rule" | "ai">("rule"); // 既定はルール順（AI未使用＝コスト0）
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return; hydrated.current = true;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(AI_STORE_KEY(personNo)) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { entries: Array<[number, { score: number; reason: string }]>; savedAt?: number };
        const fresh = !parsed.savedAt || (Date.now() - parsed.savedAt) < 24 * 3600 * 1000;
        if (fresh && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
          setAi(new Map(parsed.entries));
          const v = localStorage.getItem(VIEW_STORE_KEY(personNo));
          setView(v === "rule" ? "rule" : "ai");
        }
      }
    } catch { /* noop */ }
  }, [personNo, ranked]);
  useEffect(() => {
    try { if (typeof window !== "undefined") localStorage.setItem(VIEW_STORE_KEY(personNo), view); } catch { /* noop */ }
  }, [view, personNo]);

  const linkFor = (jno: number) => `/matching?person=${personNo}&tab=${tab}&job=${jno}`;

  const aiActive = view === "ai" && !!ai;
  const ordered = useMemo(() => {
    if (!aiActive || !ai) return ranked;
    return [...ranked].sort((a, b) => (ai.get(b.job.job_no)?.score ?? -1) - (ai.get(a.job.job_no)?.score ?? -1));
  }, [ranked, ai, aiActive]);

  const rerank = async () => {
    // 既に評価があり、現在の上位案件がすべて評価済みなら再フェッチせずAI順に切替（再課金なし）。
    if (ai && ranked.slice(0, 10).every((r) => ai.has(r.job.job_no))) {
      setView("ai"); setMsg("AI順に切り替えました（前回の評価を再利用）"); return;
    }
    setLoading(true); setMsg(null);
    try {
      const jobs = ranked.slice(0, 10).map((r) => ({
        job_no: r.job.job_no, title: r.job.title, client_name: r.job.client_name,
        skills: r.job.skills, salary_min: r.job.salary_min, salary_max: r.job.salary_max,
        remote_type: r.job.remote_type, role_label: r.job.role_label, detail: r.job.detail,
      }));
      const res = await fetch("/api/match-rerank-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate: candForAI, jobs }) });
      const data = await res.json();
      if (!data.ok) { setMsg(data.error || "再ランキングに失敗しました"); return; }
      const m = new Map<number, { score: number; reason: string }>();
      for (const r of data.results) m.set(r.job_no, { score: r.score, reason: r.reason });
      setAi(m); setView("ai");
      // 永続化：再訪時にタブ切替で復元できるよう保存。
      try {
        if (typeof window !== "undefined") {
          const ids = ranked.map((r) => r.job.job_no);
          const entries = Array.from(m.entries());
          localStorage.setItem(AI_STORE_KEY(personNo), JSON.stringify({ ids, entries, savedAt: Date.now() }));
        }
      } catch { /* noop */ }
      setMsg(data.cached
        ? "AI順に切替（キャッシュ・回数消費なし）"
        : `AIで再ランキングしました（上位10件）${typeof data.remaining === "number" ? ` ／ 本日の残り ${data.remaining}/${data.limit ?? 10} 回` : ""}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "再ランキングに失敗しました");
    } finally { setLoading(false); }
  };

  return (
    <div className="card flush" style={{ position: "sticky", top: 80 }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>マッチ案件 <span className="tag brand">{ranked.length}件</span></div>
        {ai ? (
          <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "var(--color-surface-inset)", borderRadius: 99 }}>
            {([["rule", "ルール順"], ["ai", "AI順"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setView(v)}
                style={{ padding: "4px 12px", borderRadius: 99, border: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit",
                  background: view === v ? "var(--color-surface)" : "transparent", color: view === v ? "var(--color-ink)" : "var(--color-ink-3)",
                  boxShadow: view === v ? "0 1px 2px rgba(15,23,42,.1)" : "none" }}>{label}</button>
            ))}
          </div>
        ) : (
          <button type="button" disabled={loading || ranked.length === 0} onClick={rerank}
            title="上位10件をAIが文脈評価して並べ替え（1日10回まで・キャッシュ済みは無料）"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 99, border: 0, cursor: loading || ranked.length === 0 ? "not-allowed" : "pointer",
              fontSize: 12.5, fontWeight: 800, fontFamily: "inherit", color: "#fff", whiteSpace: "nowrap",
              background: "linear-gradient(135deg, #7c3aed 0%, #0095D9 100%)",
              boxShadow: "0 2px 8px rgba(124,58,237,.35)",
              opacity: loading || ranked.length === 0 ? 0.55 : 1,
              transition: "transform .12s ease, box-shadow .12s ease",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 14px rgba(124,58,237,.45)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 8px rgba(124,58,237,.35)"; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>auto_awesome</span>
            <span>{loading ? "AI評価中…" : "AIで再ランキング"}</span>
          </button>
        )}
      </div>
      {msg && <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-border)" }}>{msg}</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ordered.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>重なる案件がありません</div>
        ) : ordered.map((r, i) => {
          const j = r.job; const active = selJobNo === j.job_no;
          const proposed = !!proposedJobIds?.has(j.id); // 提案済み（提案ボードに記録あり）
          const aiv = aiActive ? ai?.get(j.job_no) : undefined; // ルール順表示ではAIスコアを出さない
          const shown = aiv ? aiv.score : r.score;
          const rankColor = i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : i === 2 ? "#cd853f" : "var(--color-surface-inset)";
          return (
            <Link key={j.job_no} href={linkFor(j.job_no)} title={proposed ? "提案済み（提案ボードに記録あり）" : undefined} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : proposed ? "var(--color-surface-inset)" : "transparent", opacity: proposed && !active ? 0.62 : 1 }}>
              <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? rankColor : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.title}</span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400, flexShrink: 0 }}>No.{String(j.job_no).padStart(5, "0")}</span>
                  {proposed && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0", lineHeight: 1.5, flexShrink: 0 }}>✓ 提案済み</span>
                  )}
                </div>
                {/* クライアント名は出さず、案件条件（単価・リモート・国籍/年代制限・商流）を表示 */}
                <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[salaryLabel(j.salary_min, j.salary_max), remoteLabel(j.remote_type), (j.flow_note && j.flow_note !== "不明") ? j.flow_note : null].filter(Boolean).join(" · ")}</div>
                {(() => {
                  // 国籍制限・年代制限は本文(detail+title)から判定。要件がある案件のみ表示する。
                  const nat = classifyJobNationality(j.detail, j.title);
                  const age = classifyJobAge(j.detail, j.title);
                  const parts: string[] = [];
                  if (nat !== "unknown") parts.push(`国籍 ${JOB_NAT_LABEL[nat]}`);
                  if (age.cat !== "unknown") parts.push(`年代 ${age.label}`);
                  return parts.length ? <div className="muted" style={{ fontSize: 10.5, color: nat === "jp_only" || age.cat === "limited" ? "#b42318" : "var(--color-ink-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parts.join(" · ")}</div> : null;
                })()}
                {aiv && <div style={{ fontSize: 10.5, color: "var(--color-brand-700)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🤖 {aiv.reason}</div>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, color: aiv ? "var(--color-brand-700)" : "var(--color-ink-4)" }}>{aiv ? "AI相性" : "相性"}</div>
                <Stars score={shown} />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
