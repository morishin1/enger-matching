"use client";

import { useState } from "react";
import { Icons } from "@/components/icons";
import { MOCK } from "@/lib/mock";

function CompanyCard({ c }: any) {
  const tierStyle = c.tier === "A" ? { bg: "var(--color-brand-50)", color: "var(--color-brand-700)", border: "var(--color-brand-100)" }
    : c.tier === "B" ? { bg: "#fef3e2", color: "#a35f15", border: "#f6d9a7" }
    : { bg: "var(--color-surface-inset)", color: "var(--color-ink-3)", border: "var(--color-border)" };
  const statusColor = c.status === "主要" ? "var(--color-brand-600)" : c.status === "拡大中" ? "#10b981" : c.status === "新規" ? "#7a5cc4" : "var(--color-ink-4)";
  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, borderRadius: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: `linear-gradient(135deg, ${c.color}, ${c.color}aa)`, color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>{c.initials}</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--color-ink)", lineHeight: 1.3 }}>{c.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>{c.id}</span>
              <span style={{ color: "var(--color-ink-5)" }}>·</span>
              <span style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>{c.industry}</span>
            </div>
          </div>
        </div>
        <div style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "0.02em", background: tierStyle.bg, color: tierStyle.color, border: `1px solid ${tierStyle.border}` }}>{c.tier}</div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", lineHeight: 1.55, minHeight: 32 }}>{c.note}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)" }}>
        {[["進行中", `${c.activeJobs}`, "件", "var(--color-ink)"], ["過去成約", `${c.lastDeals}`, "件", "var(--color-ink)"], ["累計取引", c.totalRevenue, "", "var(--color-brand-700)"]].map(([lbl, v, u, col], i) => (
          <div key={i} style={{ background: "var(--color-surface)", padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: "var(--color-ink-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>{lbl}</div>
            <div className="display tnum" style={{ fontSize: 20, fontWeight: 700, color: col, marginTop: 2 }}>{v}{u && <span style={{ fontSize: 11, color: "var(--color-ink-4)", marginLeft: 2, fontWeight: 500 }}>{u}</span>}</div>
          </div>
        ))}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 600 }}>関係スコア</span>
          <span className="mono tnum" style={{ fontSize: 11.5, color: "var(--color-ink-2)", fontWeight: 600 }}>{c.relation}</span>
        </div>
        <div style={{ height: 4, background: "var(--color-surface-inset)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ width: `${c.relation}%`, height: "100%", background: c.color, borderRadius: 99 }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="ava" style={{ width: 24, height: 24, fontSize: 10 }}>{c.ownerInit}</div>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--color-ink-2)", fontWeight: 500 }}>{c.owner}</div>
            <div style={{ fontSize: 10, color: "var(--color-ink-4)", fontFamily: "var(--font-mono)" }}>更新 {c.lastActivity}</div>
          </div>
        </div>
        <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>● {c.status}</span>
      </div>
    </div>
  );
}

export default function CompaniesPage() {
  const [tier, setTier] = useState("ALL");
  const [search, setSearch] = useState("");
  const all = MOCK.companies;
  const filtered = all.filter((c) => (tier === "ALL" || c.tier === tier) && (!search || c.name.includes(search) || c.industry.includes(search)));
  const counts: Record<string, number> = { ALL: all.length, A: all.filter((c) => c.tier === "A").length, B: all.filter((c) => c.tier === "B").length, C: all.filter((c) => c.tier === "C").length };
  const activeTotal = all.reduce((a, b) => a + b.activeJobs, 0);
  const newCount = all.filter((c) => c.status === "新規").length;
  const dormantCount = all.filter((c) => c.status === "休眠").length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Companies · 取引先</div>
          <h1>企業管理</h1>
          <div className="sub">取引先 <b style={{ color: "var(--color-ink)" }}>{all.length} 社</b> · 進行中案件 <b style={{ color: "var(--color-ink)" }}>{activeTotal} 件</b>。主要 A 層が累計取引の 80% を占めます。</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "center" }}>
          <button className="btn"><Icons.filter /><span>絞り込み</span></button>
          <button className="btn brand"><Icons.plus /><span>新規企業</span></button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi brand">
          <div className="top"><div className="ico-box"><Icons.building /></div><div className="chip flat">{counts.A}社 / A</div></div>
          <div><div className="val tnum">{all.length}<span className="unit">社</span></div><div className="label">取引先 全数</div><div className="note">{newCount} 新規 · {dormantCount} 休眠</div></div>
        </div>
        <div className="kpi">
          <div className="top"><div className="ico-box"><Icons.jobs /></div><div className="chip">+5</div></div>
          <div><div className="val tnum">{activeTotal}<span className="unit">件</span></div><div className="label">進行中案件</div><div className="note">12 社で募集中</div></div>
        </div>
        <div className="kpi warn">
          <div className="top"><div className="ico-box"><Icons.yen /></div><div className="chip">+¥48M</div></div>
          <div><div className="val tnum">¥532M</div><div className="label">累計取引額</div><div className="note">過去 12 ヶ月</div></div>
        </div>
        <div className="kpi accent">
          <div className="top"><div className="ico-box"><Icons.star /></div><div className="chip">+2pt</div></div>
          <div><div className="val tnum">74</div><div className="label">平均関係スコア</div><div className="note">主要層は 88+</div></div>
        </div>
      </div>

      <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {[{ id: "ALL", label: "全て" }, { id: "A", label: "A · 主要" }, { id: "B", label: "B · 拡大" }, { id: "C", label: "C · 維持" }].map((t) => (
            <button key={t.id} onClick={() => setTier(t.id)} style={{ padding: "6px 14px", borderRadius: 99, border: 0, background: tier === t.id ? "var(--color-surface)" : "transparent", color: tier === t.id ? "var(--color-ink)" : "var(--color-ink-3)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", boxShadow: tier === t.id ? "0 1px 2px rgba(15,23,42,0.06)" : "none", cursor: "pointer" }}>
              {t.label} <span style={{ color: "var(--color-ink-4)", fontFamily: "var(--font-mono)", marginLeft: 4, fontWeight: 500 }} className="tnum">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="search" style={{ marginLeft: 0, width: 260 }}>
          <span style={{ display: "grid", placeItems: "center" }}><Icons.search /></span>
          <input placeholder="企業名・業種で検索…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-3)" }}>並び順:</span>
          <select style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 12px", borderRadius: 99, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
            <option>累計取引額</option><option>関係スコア</option><option>進行中案件数</option><option>最終アクティビティ</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--gap, 20px)" }}>
        {filtered.map((c) => <CompanyCard key={c.id} c={c} />)}
      </div>
    </div>
  );
}
