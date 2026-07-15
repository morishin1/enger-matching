"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/AppLink";
import { Icons } from "@/components/icons";
import { classifyCandNationality, CAND_NAT_LABEL } from "@/lib/nationality";

// 単価表示（rate が無いとき salary_min/max から組み立て）。
const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "";

function Stars({ score }: { score: number }) {
  const n = Math.max(0, Math.min(5, Math.round(score / 20)));
  return <span style={{ color: "#f0a92b", letterSpacing: 1, fontSize: 13 }}>{"★".repeat(n)}<span style={{ color: "var(--color-ink-5)" }}>{"★".repeat(5 - n)}</span></span>;
}

type Ranked = { candidate: any; score: number; dupCount?: number; dupNos?: number[]; flow?: { compat: "ok" | "ng" | "unknown" } };

// AI再ランキング結果と表示モードを案件単位で永続化するための localStorage キー。
//   再訪時に「タブで切替」状態がそのまま使えるようにする（トークン無駄消費の防止）。
const AI_STORE_KEY = (jobNo: number) => `enger.match.ai.v1.${jobNo}`;
const VIEW_STORE_KEY = (jobNo: number) => `enger.match.view.v1.${jobNo}`;

export function RankList({ jobAbbr, jobNo, tab, selCandNo, ranked, proposedCandIds, lineCandIds, flCandIds, jobForAI }: {
  jobAbbr: string; jobNo: number; tab: string; selCandNo?: number; ranked: Ranked[]; proposedCandIds?: Set<string>; lineCandIds?: Set<string>; flCandIds?: Set<string>; jobForAI: any;
}) {
  const [ai, setAi] = useState<Map<number, { score: number; reason: string }> | null>(null);
  const [view, setView] = useState<"rule" | "ai">("rule"); // 既定はルール順（AI未使用＝コスト0）
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 初期マウント時に localStorage から復元（同じ案件を再度開いてもAI評価をそのまま使える）。
  //   候補が多少入れ替わっても復元する（AI順では評価のある候補が上位・無い候補は末尾）。
  //   24時間以内に保存したものだけ復元（古すぎる評価は使わない）。
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return; hydrated.current = true;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(AI_STORE_KEY(jobNo)) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { entries: Array<[number, { score: number; reason: string }]>; savedAt?: number };
        const fresh = !parsed.savedAt || (Date.now() - parsed.savedAt) < 24 * 3600 * 1000;
        if (fresh && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
          setAi(new Map(parsed.entries));
          const v = localStorage.getItem(VIEW_STORE_KEY(jobNo));
          setView(v === "rule" ? "rule" : "ai");
        }
      }
    } catch { /* JSON 破損・localStorage 不可は無視 */ }
  }, [jobNo, ranked]);
  // view の変更は永続化（次回開いた時の既定表示が一致する）。
  useEffect(() => {
    try { if (typeof window !== "undefined") localStorage.setItem(VIEW_STORE_KEY(jobNo), view); } catch { /* noop */ }
  }, [view, jobNo]);

  const linkFor = (no: number) => `/matching?tab=${tab}&job=${jobNo}&cand=${no}`;

  // AI順で表示するのは view==="ai" かつ AI評価がある時だけ
  const aiActive = view === "ai" && !!ai;
  const ordered = useMemo(() => {
    if (!aiActive || !ai) return ranked;
    return [...ranked].sort((a, b) => (ai.get(b.candidate.candidate_no)?.score ?? -1) - (ai.get(a.candidate.candidate_no)?.score ?? -1));
  }, [ranked, ai, aiActive]);

  const rerank = async () => {
    // 既に評価があり、現在の上位候補がすべて評価済みなら、再フェッチせずAI順に切替（再課金なし）。
    //   候補が入れ替わって未評価が混じる場合は再取得（多くはサーバ側キャッシュで無料）。
    if (ai && ranked.slice(0, 10).every((r) => ai.has(r.candidate.candidate_no))) {
      setView("ai"); setMsg("AI順に切り替えました（前回の評価を再利用）"); return;
    }
    setLoading(true); setMsg(null);
    try {
      // コスト最小化のため上位10件だけAIに渡す。スキルシートのAI要約があれば文脈として同梱。
      const candidates = ranked.slice(0, 10).map((r) => ({
        candidate_no: r.candidate.candidate_no, name: r.candidate.name, title: r.candidate.title,
        skills: r.candidate.skills, rate: r.candidate.rate, exp: r.candidate.exp, remote_pref: r.candidate.remote_pref,
        skill_sheet_summary: r.candidate.skill_sheet_summary ?? null,
      }));
      const res = await fetch("/api/match-rerank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: jobForAI, candidates }) });
      const data = await res.json();
      if (!data.ok) { setMsg(data.error || "再ランキングに失敗しました"); return; }
      const m = new Map<number, { score: number; reason: string }>();
      for (const r of data.results) m.set(r.candidate_no, { score: r.score, reason: r.reason });
      setAi(m); setView("ai");
      // 永続化：候補集合と評価マップを保存し、次回マッチング結果画面を開いてもタブで切替可能に。
      try {
        if (typeof window !== "undefined") {
          const ids = ranked.map((r) => r.candidate.candidate_no);
          const entries = Array.from(m.entries());
          localStorage.setItem(AI_STORE_KEY(jobNo), JSON.stringify({ ids, entries, savedAt: Date.now() }));
        }
      } catch { /* localStorage 不可は無視 */ }
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
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{jobAbbr} のマッチング人材 <span className="tag brand">{ranked.length}件</span></div>
        {ai ? (
          // 取得済みは「ルール順 / AI順」をワンタップで切替（再課金なし）
          <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "var(--color-surface-inset)", borderRadius: 99 }}>
            {([["rule", "ルール順"], ["ai", "AI順"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setView(v)}
                style={{ padding: "4px 12px", borderRadius: 99, border: 0, cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit",
                  background: view === v ? "var(--color-surface)" : "transparent", color: view === v ? "var(--color-ink)" : "var(--color-ink-3)",
                  boxShadow: view === v ? "0 1px 2px rgba(15,23,42,.1)" : "none" }}>{label}</button>
            ))}
          </div>
        ) : (
          // 目立つグラデーションボタン（ボタンが小さくて見えづらかったので強調）
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
      {(() => {
        // 同姓同名の重複候補をハイライト（取込で別レコードになっている可能性をUI上で示す）
        const nameCount = new Map<string, number>();
        for (const r of ordered) { const k = (r.candidate.name ?? "").trim(); if (k) nameCount.set(k, (nameCount.get(k) ?? 0) + 1); }
        return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {ordered.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>重なる人材がいません</div>
        ) : ordered.map((r, i) => {
          const c = r.candidate;
          const active = selCandNo === c.candidate_no;
          const proposed = !!proposedCandIds?.has(c.id); // 提案済み（提案ボードに記録あり）
          const aiv = aiActive ? ai?.get(c.candidate_no) : undefined; // ルール順表示ではAIスコアを出さない
          const shown = aiv ? aiv.score : r.score;
          const nameCollision = nameCount.get((c.name ?? "").trim()) ?? 0;
          const mergedCount = r.dupCount ?? 0; // 厳格判定で同一人物として畳んだ件数
          const rankColor = i === 0 ? "#f0a92b" : i === 1 ? "#9aa7b4" : i === 2 ? "#cd853f" : "var(--color-surface-inset)";
          return (
            <Link key={c.candidate_no} href={linkFor(c.candidate_no)} title={proposed ? "提案済み（提案ボードに記録あり）" : undefined} style={{ textDecoration: "none", color: "inherit", display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)", borderLeft: active ? "3px solid var(--color-brand-700)" : "3px solid transparent", background: active ? "var(--color-brand-25)" : proposed ? "var(--color-surface-inset)" : "transparent", opacity: proposed && !active ? 0.62 : 1 }}>
              <span style={{ width: 24, height: 24, borderRadius: 99, background: i < 3 ? rankColor : "var(--color-surface-inset)", color: i < 3 ? "#fff" : "var(--color-ink-3)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display)" }}>{i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", display: "flex", alignItems: "center", gap: 6 }}>
                  {jobAbbr} ↔ {lineCandIds?.has(c.id) && <span title="LINE経由の人材" style={{ lineHeight: 0, display: "inline-flex", flexShrink: 0 }}><Icons.line size={12} /></span>}{c.name}
                  <span className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400, flexShrink: 0 }}>P-{String(c.candidate_no).padStart(5, "0")}</span>
                  {flCandIds?.has(c.id) && <span title="ENGERフリーランスで登録された人材" style={{ lineHeight: 0, display: "inline-flex", flexShrink: 0 }}><Icons.engerFreelance size={12} /></span>}
                  {mergedCount > 1 && (
                    <span title={`同一人物とみなせる重複レコード ${mergedCount} 件を1件に集約して表示しています（イニシャル＋スキル8割以上＋単価＋所属/登録元が一致）。${r.dupNos?.length ? "対象: " + r.dupNos.map((n: number) => "P-" + String(n).padStart(5, "0")).join(", ") : ""}`} style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#eef2ff", color: "#3730a3", border: "1px solid #c7d2fe", lineHeight: 1.5, flexShrink: 0 }}>統合 {mergedCount}件</span>
                  )}
                  {mergedCount <= 1 && nameCollision > 1 && (
                    <span title="イニシャルが同じ別レコードがランキング内にあります（別人の可能性が高い）。クリックして会社・スキル・単価で確認してください。" style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#fff1e6", color: "#b45309", border: "1px solid #fde9b0", lineHeight: 1.5, flexShrink: 0 }}>同名 {nameCollision}件</span>
                  )}
                  {proposed && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0", lineHeight: 1.5, flexShrink: 0 }}>✓ 提案済み</span>
                  )}
                  {r.flow?.compat === "ng" && (
                    <span title="案件の受入商流の上限を超えています。提案前に確認してください。" style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf", lineHeight: 1.5, flexShrink: 0 }}>商流NG</span>
                  )}
                </div>
                {(() => {
                  // 職種・クライアント名（所属会社名）は出さず、人材の「単価 / 所属区分 / 国籍 / 年代」のみを表示。
                  //   会社名が長くて他情報が埋もれる問題への対応（要望）。
                  const nat = classifyCandNationality(c.nationality);
                  const natLabel = nat === "unknown" ? "国籍不明" : CAND_NAT_LABEL[nat];
                  const sub = [
                    c.rate || salaryLabel(c.salary_min, c.salary_max),
                    c.affiliation,
                    natLabel,
                    c.age_band,
                  ].filter(Boolean).join(" · ");
                  // #431：人材側に「最寄り駅」「居住地」の入力があれば、単価/国籍/年代の下に追加表示する。
                  const place = [
                    c.location ? `最寄り駅: ${c.location}` : null,
                    c.residence ? `居住地: ${c.residence}` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <>
                      <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub || "—"}</div>
                      {place && <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place}</div>}
                      {aiv && <div style={{ fontSize: 10.5, color: "var(--color-brand-700)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🤖 {aiv.reason}</div>}
                    </>
                  );
                })()}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, color: aiv ? "var(--color-brand-700)" : "var(--color-ink-4)" }}>{aiv ? "AI相性" : "相性"}</div>
                <Stars score={shown} />
              </div>
            </Link>
          );
        })}
      </div>
        );
      })()}
    </div>
  );
}
