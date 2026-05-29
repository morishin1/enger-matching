"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

function Stars({ score }: { score: number }) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return <span style={{ color: "#f0a92b", letterSpacing: 1, fontSize: 13 }}>{"★".repeat(n)}<span style={{ color: "var(--color-ink-5)" }}>{"★".repeat(5 - n)}</span></span>;
}

type Ranked = { candidate: any; score: number };

export function RankList({ jobAbbr, jobNo, tab, selCandNo, ranked, proposedCandIds, jobForAI }: {
  jobAbbr: string; jobNo: number; tab: string; selCandNo?: number; ranked: Ranked[]; proposedCandIds?: Set<string>; jobForAI: any;
}) {
  const [ai, setAi] = useState<Map<number, { score: number; reason: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const linkFor = (no: number) => `/matching?tab=${tab}&job=${jobNo}&cand=${no}`;

  // AI再ランキング適用後の並び
  const ordered = useMemo(() => {
    if (!ai) return ranked;
    return [...ranked].sort((a, b) => (ai.get(b.candidate.candidate_no)?.score ?? -1) - (ai.get(a.candidate.candidate_no)?.score ?? -1));
  }, [ranked, ai]);

  const rerank = async () => {
    setLoading(true); setMsg(null);
    try {
      const candidates = ranked.map((r) => ({
        candidate_no: r.candidate.candidate_no, name: r.candidate.name, title: r.candidate.title,
        skills: r.candidate.skills, rate: r.candidate.rate, exp: r.candidate.exp, remote_pref: r.candidate.remote_pref,
      }));
      const res = await fetch("/api/match-rerank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: jobForAI, candidates }) });
      const data = await res.json();
      if (!data.ok) { setMsg(data.error || "再ランキングに失敗しました"); return; }
      const m = new Map<number, { score: number; reason: string }>();
      for (const r of data.results) m.set(r.candidate_no, { score: r.score, reason: r.reason });
      setAi(m);
      setMsg("AIで再ランキングしました（相性スコアにAI評価を反映）");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "再ランキングに失敗しました");
    } finally { setLoading(false); }
  };

  return (
    <div className="card flush" style={{ position: "sticky", top: 80 }}>
      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{jobAbbr} のマッチング人材 <span className="tag brand">{ranked.length}件</span></div>
        <button type="button" className="btn ghost btn-xs" disabled={loading || ranked.length === 0} onClick={rerank} title="上位候補をAIが文脈評価して並べ替え">{loading ? "AI評価中…" : ai ? "✓ AI再評価済" : "✨ AIで再ランキング"}</button>
      </div>
      {msg && <div style={{ padding: "8px 16px", fontSize: 11, color: "var(--color-ink-3)", borderBottom: "1px solid var(--color-border)" }}>{msg}</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ordered.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>重なる人材がいません</div>
        ) : ordered.map((r, i) => {
          const c = r.candidate;
          const active = selCandNo === c.candidate_no;
          const aiv = ai?.get(c.candidate_no);
          const shown = aiv ? aiv.score : r.score;
          const rankColor = i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : i === 2 ? "#cd853f" : "var(--color-surface-inset)";
          return (
            <Link key={c.candidate_no} href={linkFor(c.candidate_no)} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : "transparent" }}>
              <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? rankColor : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6 }}>
                  {jobAbbr} ↔ {c.name}
                  {proposedCandIds?.has(c.id) && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#eef8f1", color: "#1aa260", border: "1px solid #bfe3cc", lineHeight: 1.5, flexShrink: 0 }}>記録済み</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{aiv ? `🤖 ${aiv.reason}` : `${c.title ?? "—"} · ${(() => { const co = c.source_company || c.company || ""; return co && c.affiliation ? `${co}（${c.affiliation}）` : (co || c.affiliation || ""); })()}`}</div>
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
