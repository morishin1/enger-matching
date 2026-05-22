"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icons } from "./icons";
import type { CompanyRow } from "@/lib/companies";

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

type SortKey = "job_count" | "active_jobs" | "avg_rate" | "last_job_at";

export function CompaniesView({ companies }: { companies: CompanyRow[] }) {
  const [tier, setTier] = useState("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("active_jobs");

  const counts = useMemo(() => ({
    ALL: companies.length,
    A: companies.filter((c) => c.tier === "A").length,
    B: companies.filter((c) => c.tier === "B").length,
    C: companies.filter((c) => c.tier === "C").length,
  }), [companies]);

  const filtered = useMemo(() => {
    const needle = search.trim();
    const rows = companies.filter((c) => (tier === "ALL" || c.tier === tier) && (!needle || c.name.includes(needle)));
    return [...rows].sort((a, b) => {
      if (sort === "last_job_at") return (b.last_job_at ?? "").localeCompare(a.last_job_at ?? "");
      return (b[sort] ?? 0) - (a[sort] ?? 0);
    });
  }, [companies, tier, search, sort]);

  return (
    <>
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
                <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: "var(--font-display)", background: ts.bg, color: ts.color, border: `1px solid ${ts.border}` }}>{c.tier}</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
                {[["進行中", `${c.active_jobs}`, "件", "var(--color-ink)"], ["全案件", `${c.job_count}`, "件", "var(--color-ink)"], ["平均単価", c.avg_rate != null ? `¥${c.avg_rate}` : "—", c.avg_rate != null ? "万" : "", "var(--color-brand-700)"]].map(([lbl, v, u, col], i) => (
                  <div key={i} style={{ background: "var(--color-surface)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "var(--color-ink-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{lbl}</div>
                    <div className="display tnum" style={{ fontSize: 19, fontWeight: 700, color: col as string, marginTop: 2 }}>{v}{u && <span style={{ fontSize: 11, color: "var(--color-ink-4)", marginLeft: 2, fontWeight: 500 }}>{u}</span>}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>最終案件 {dateLabel(c.last_job_at)}</span>
                <Link href={`/jobs?client=${encodeURIComponent(c.name)}`} className="btn ghost btn-xs" style={{ textDecoration: "none" }}>案件を見る</Link>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
