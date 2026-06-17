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
  contract_types?: string[] | null;
  review_status?: string | null;
  is_published?: boolean | null;
  posted_by_client?: boolean | null;
  proposalCount: number;
  activeCount: number;
  applicantCount?: number;   // LP「応募する」経由の応募者数（enger.applications）
};

const statusBadge = (j: PortalJob) => {
  if (j.posted_by_client && j.review_status === "pending") return { label: "審査中", bg: "#fef9c3", fg: "#854d0e" };
  if (j.posted_by_client && j.review_status === "rejected") return { label: "却下", bg: "#fdecef", fg: "#b42318" };
  if (j.is_published) return { label: "公開中", bg: "#e7f7ee", fg: "#067647" };
  return null;
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
              {(() => { const b = statusBadge(j); return b ? <span style={{ alignSelf: "flex-start", fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: b.bg, color: b.fg }}>{b.label}</span> : null; })()}
              <div className="muted" style={{ fontSize: 12 }}>{[j.role_label, remote(j.remote_type), salary(j.salary_min, j.salary_max)].filter(Boolean).join(" · ")}</div>
              {j.contract_types && j.contract_types.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {j.contract_types.map((c) => <span key={c} style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "var(--color-brand-50)", color: "var(--color-brand-700)" }}>{c}</span>)}
                </div>
              )}
              {j.skills && j.skills.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {j.skills.slice(0, 6).map((s) => (
                    <span key={s} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 999, background: "var(--color-brand-25)", color: "var(--color-brand-700, #0b5cab)" }}>{s}</span>
                  ))}
                </div>
              )}
              <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--color-border)", display: "flex", gap: 14, fontSize: 12, alignItems: "center", flexWrap: "wrap" }}>
                <span>ご提案 <b>{j.proposalCount}</b> 件</span>
                <span style={{ color: "var(--color-brand-700, #0b5cab)" }}>進行中 <b>{j.activeCount}</b> 件</span>
                {(j.applicantCount ?? 0) > 0 && (
                  <a href="/portal/selection" title="応募者の選考状況を見る" style={{ color: "#067647", textDecoration: "none", fontWeight: 700 }}>応募 <b>{j.applicantCount}</b> 人 →</a>
                )}
                <a
                  href={`https://twitter.com/intent/tweet?${new URLSearchParams({ text: `【エンジニア募集】${[j.role_label, remote(j.remote_type), salary(j.salary_min, j.salary_max)].filter(Boolean).join(" · ")}\n${(j.skills ?? []).slice(0,4).join(" / ")}\n詳細・ご応募はENGERから👇\n#エンジニア募集 #エンジニア転職`, url: "https://enger.jp/jobs" }).toString()}`}
                  target="_blank" rel="noopener"
                  title="この募集をXでシェア（エンジニアに届けます）"
                  style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700,#0b5cab)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                >𝕏 シェア</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
