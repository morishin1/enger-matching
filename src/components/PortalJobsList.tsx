"use client";

import { useState, useMemo } from "react";

export type PortalJob = {
  job_no: number | string;
  title: string | null;
  role_label: string | null;
  salary_min: number | null;
  salary_max: number | null;
  remote_type: string | null;
  status: string | null;
  skills: string[] | null;
  proposalCount: number;
  activeCount: number;
};

const salary = (a?: number | null, b?: number | null) => {
  if (!a && !b) return "—";
  const f = (n?: number | null) => (n == null ? "" : `${Math.round(n / 10000)}万`);
  return a && b ? `${f(a)}〜${f(b)}` : f(a || b);
};
const remote = (t?: string | null) => ({ full: "フルリモート", hybrid: "ハイブリッド", onsite: "出社" } as Record<string, string>)[t ?? ""] ?? (t || "—");

export function PortalJobsList({ jobs }: { jobs: PortalJob[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return jobs;
    return jobs.filter((j) =>
      [j.title, j.role_label, ...(j.skills ?? [])].filter(Boolean).join(" ").toLowerCase().includes(t)
    );
  }, [q, jobs]);

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="案件名・職種・スキルで絞り込み…"
          style={{ width: "100%", maxWidth: 420, padding: "10px 14px", border: "1px solid var(--color-border)", borderRadius: 10, fontSize: 13.5, outline: "none" }}
        />
        <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>{filtered.length} 件</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ fontSize: 13 }} >該当する案件はありません。</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filtered.map((j) => (
            <div key={j.job_no} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{j.title ?? "（無題）"}</div>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)", flexShrink: 0 }}>#{j.job_no}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{[j.role_label, remote(j.remote_type), salary(j.salary_min, j.salary_max)].filter(Boolean).join(" · ")}</div>
              {j.skills && j.skills.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {j.skills.slice(0, 6).map((s) => (
                    <span key={s} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "var(--color-brand-25)", color: "var(--color-brand-700, #0b5cab)" }}>{s}</span>
                  ))}
                </div>
              )}
              <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--color-border)", display: "flex", gap: 14, fontSize: 12 }}>
                <span>ご提案 <b>{j.proposalCount}</b> 件</span>
                <span style={{ color: "var(--color-brand-700, #0b5cab)" }}>進行中 <b>{j.activeCount}</b> 件</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
