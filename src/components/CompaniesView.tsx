"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icons } from "./icons";
import { targetScore, type CompanyRow } from "@/lib/companies";

const sentTone = (s: string | null) => !s ? null : s.includes("ポジ") ? { c: "#1aa260", t: s } : s.includes("ネガ") ? { c: "#d23f57", t: s } : s.includes("競合") ? { c: "#d98a2b", t: s } : { c: "#6b7280", t: s };
const scoreColor = (n: number) => n >= 70 ? "#1aa260" : n >= 45 ? "#0095D9" : n >= 25 ? "#d98a2b" : "#9aa7b4";

const PALETTE = ["#0095D9", "#7c5cff", "#1aa260", "#e0567f", "#d98a2b", "#3aa6b9", "#b5651d"];
const colorOf = (s: string) => PALETTE[Array.from(s).reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initialsOf = (name: string) => name.replace(/(株式会社|有限会社|\(株\)|（株）|株式会社)/g, "").trim().slice(0, 2) || name.slice(0, 2);
const dateLabel = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
};
const tierStyle = (t: string) => t === "A"
  ? { bg: "var(--color-brand-50)", color: "var(--color-brand-700)", border: "var(--color-brand-100)" }
  : t === "B" ? { bg: "#fef3e2", color: "#a35f15", border: "#f6d9a7" }
  : { bg: "var(--color-surface-inset)", color: "var(--color-ink-3)", border: "var(--color-border)" };
const statusColor = (s: string) => s === "主要" ? "var(--color-brand-600)" : s === "拡大中" ? "#10b981" : s === "新規" ? "#7a5cc4" : "var(--color-ink-4)";

type SortKey = "target" | "job_count" | "active_jobs" | "avg_rate" | "last_job_at";

export function CompaniesView({ companies }: { companies: CompanyRow[] }) {
  const [tier, setTier] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("target");

  // 狙い目スコアを各社に付与
  const scored = useMemo(() => companies.map((c) => ({ ...c, ...targetScore(c) })), [companies]);

  const counts = useMemo(() => ({
    ALL: scored.length,
    A: scored.filter((c) => c.tier === "A").length,
    B: scored.filter((c) => c.tier === "B").length,
    C: scored.filter((c) => c.tier === "C").length,
  }), [scored]);

  const filtered = useMemo(() => {
    const needle = search.trim();
    const rows = scored.filter((c) => (tier === "ALL" || c.tier === tier) && (!needle || c.name.includes(needle)));
    return [...rows].sort((a, b) => {
      if (sort === "last_job_at") return (b.last_job_at ?? "").localeCompare(a.last_job_at ?? "");
      return ((b as any)[sort] ?? 0) - ((a as any)[sort] ?? 0);
    });
  }, [scored, tier, search, sort]);

  const top = useMemo(() => [...scored].sort((a, b) => b.score - a.score).slice(0, 5), [scored]);

  return (
    <>
      {/* 今狙うべき企業 TOP5 */}
      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>🎯 今狙うべき企業 TOP5</h3>
          <span className="muted" style={{ fontSize: 11 }}>供給力 × 実績 × 温度感 × 関係性 × 鮮度</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          {top.map((c, i) => (
            <Link key={c.name} href={`/jobs?client=${encodeURIComponent(c.name)}`} style={{ textDecoration: "none", color: "inherit", display: "flex", gap: 10, alignItems: "center", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "10px 12px" }}>
              <div className="display tnum" style={{ width: 36, height: 36, borderRadius: 10, flex: "0 0 36px", display: "grid", placeItems: "center", background: `${scoreColor(c.score)}1a`, color: scoreColor(c.score), fontWeight: 800 }}>{c.score}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {c.name}</div>
                <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.reasons.join(" / ") || `募集中${c.active_jobs}件`}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {[{ id: "ALL", label: "全て" }, { id: "A", label: "A · 主要" }, { id: "B", label: "B · 拡大" }, { id: "C", label: "C · 維持" }].map((t) => (
            <button key={t.id} onClick={() => setTier(t.id)} style={{ padding: "6px 14px", borderRadius: 99, border: 0, background: tier === t.id ? "var(--color-surface)" : "transparent", color: tier === t.id ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", boxShadow: tier === t.id ? "0 1px 2px rgba(15,23,42,0.06)" : "none", cursor: "pointer" }}>
              {t.label} <span style={{ color: "var(--color-ink-4)", fontFamily: "var(--font-mono)", marginLeft: 4, fontWeight: 500 }} className="tnum">{counts[t.id as keyof typeof counts]}</span>
            </button>
          ))}
        </div>
        <div className="tbl-search" style={{ width: 240, flex: "0 0 240px" }}>
          <Icons.search />
          <input placeholder="企業名で検索…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>並び順:</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 12px", borderRadius: 99, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option value="target">狙い目スコア</option>
            <option value="active_jobs">進行中案件</option>
            <option value="job_count">案件数</option>
            <option value="avg_rate">平均単価</option>
            <option value="last_job_at">最終更新</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {filtered.length === 0 ? (
          <div className="card" style={{ gridColumn: "1 / -1", textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>該当する企業がありません。</div>
        ) : filtered.map((c) => {
          const color = colorOf(c.name);
          const ts = tierStyle(c.tier);
          return (
            <div key={c.name} className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, borderRadius: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 12, flex: "0 0 46px", background: `linear-gradient(135deg, ${color}, ${color}aa)`, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{initialsOf(c.name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--color-ink)", lineHeight: 1.3 }}>{c.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: statusColor(c.status), fontWeight: 600 }}>● {c.status}</span>
                      {c.focus_jobs > 0 && <span className="tag" style={{ fontSize: 10, color: "#e0567f" }}>♥ 注力{c.focus_jobs}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <div title="狙い目スコア" style={{ width: 46, height: 46, borderRadius: 12, background: `${scoreColor(c.score)}1a`, color: scoreColor(c.score), display: "grid", placeItems: "center", lineHeight: 1 }}>
                    <span className="display tnum" style={{ fontSize: 17, fontWeight: 800 }}>{c.score}</span>
                    <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".05em" }}>狙い目</span>
                  </div>
                  <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, fontFamily: "var(--font-display)", background: ts.bg, color: ts.color, border: `1px solid ${ts.border}` }}>{c.tier}</span>
                </div>
              </div>

              {/* 温度感 */}
              {(c.last_sentiment || c.last_relation || c.meeting_count > 0) && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {(() => { const st = sentTone(c.last_sentiment); return st ? <span className="pill" style={{ fontSize: 10.5, background: `${st.c}1a`, color: st.c, borderColor: "transparent" }}>{st.t}</span> : null; })()}
                  {c.last_relation && <span className="tag" style={{ fontSize: 10.5 }}>{c.last_relation}</span>}
                  {c.meeting_count > 0 && <span className="muted" style={{ fontSize: 10.5 }}>打合せ{c.meeting_count}回</span>}
                </div>
              )}

              {c.reasons.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {c.reasons.map((r: string) => <span key={r} className="tag" style={{ fontSize: 10, background: "var(--color-brand-25)", color: "var(--color-brand-700)" }}>{r}</span>)}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
                {[["進行中", `${c.active_jobs}`, "件", "var(--color-ink)"], ["平均単価", c.avg_rate != null ? `¥${c.avg_rate}` : "—", c.avg_rate != null ? "万" : "", "var(--color-brand-700)"], ["稼働", `${c.won}`, "件", "#1aa260"], ["失注", `${c.lost}`, "件", c.lost > 0 ? "#d23f57" : "var(--color-ink-3)"]].map(([lbl, v, u, col], i) => (
                  <div key={i} style={{ background: "var(--color-surface)", padding: "9px 10px" }}>
                    <div style={{ fontSize: 9.5, color: "var(--color-ink-4)", letterSpacing: "0.04em", fontWeight: 600 }}>{lbl}</div>
                    <div className="display tnum" style={{ fontSize: 17, fontWeight: 700, color: col as string, marginTop: 2 }}>{v}{u && <span style={{ fontSize: 10, color: "var(--color-ink-4)", marginLeft: 1, fontWeight: 500 }}>{u}</span>}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>最終案件 {dateLabel(c.last_job_at)}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <Link href={`/meetings`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>打合せ</Link>
                  <Link href={`/jobs?client=${encodeURIComponent(c.name)}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>案件</Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
