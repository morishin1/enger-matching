"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewClientJob } from "@/app/portal/actions";

export type PendingJob = {
  job_no: number;
  title: string | null;
  client_name: string | null;
  role_label: string | null;
  salary_min: number | null;
  salary_max: number | null;
  contract_types: string[] | null;
  description: string | null;
  posted_by_email: string | null;
  created_at: string | null;
};

const salary = (a?: number | null, b?: number | null) => {
  const f = (n?: number | null) => (n == null ? "" : `${Math.round(n / 10000)}万`);
  if (!a && !b) return "—";
  return a && b ? `${f(a)}〜${f(b)}` : f(a || b);
};

export function PendingClientJobs({ jobs }: { jobs: PendingJob[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);

  if (jobs.length === 0) return null;

  const act = (jobNo: number, approve: boolean) => {
    setBusy(jobNo);
    start(async () => {
      await reviewClientJob(jobNo, approve);
      setBusy(null);
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ borderColor: "var(--color-warn, #e0a317)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="material-symbols-outlined" style={{ color: "#b45309" }}>fact_check</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>企業掲載の承認待ち <span className="muted" style={{ fontWeight: 400 }}>（{jobs.length}件）</span></h3>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {jobs.map((j) => (
          <div key={j.job_no} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "11px 13px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            <div style={{ minWidth: 0, flex: "1 1 280px" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{j.title ?? "（無題）"} <span className="mono muted" style={{ fontSize: 10.5 }}>#{j.job_no}</span></div>
              <div className="muted" style={{ fontSize: 11.5 }}>{[j.client_name, j.role_label, salary(j.salary_min, j.salary_max)].filter(Boolean).join(" · ")}{j.posted_by_email ? ` · ${j.posted_by_email}` : ""}</div>
              {j.contract_types && j.contract_types.length > 0 && (
                <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                  {j.contract_types.map((c) => <span key={c} style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 5, background: "var(--color-brand-50)", color: "var(--color-brand-700)" }}>{c}</span>)}
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button className="btn brand btn-xs" disabled={pending && busy === j.job_no} onClick={() => act(j.job_no, true)}>承認して公開</button>
              <button className="btn ghost btn-xs" disabled={pending && busy === j.job_no} onClick={() => act(j.job_no, false)} style={{ color: "#b42318" }}>却下</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
