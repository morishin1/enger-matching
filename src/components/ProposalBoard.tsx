"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, PROPOSAL_STAGES } from "@/lib/actions";

const STAGES = [...PROPOSAL_STAGES];

const STAGE_TONE: Record<string, string> = {
  新規提案: "#6b7280", 提案中: "#0095D9", 面談調整: "#7c5cff", 条件交渉: "#d98a2b", 成約間近: "#e0567f", 成約: "#1aa260",
};

export function ProposalBoard({ proposals }: { proposals: any[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const move = (id: string, stage: string) => {
    setBusyId(id);
    start(async () => { await updateProposalStage(id, stage); router.refresh(); setBusyId(null); });
  };
  const lose = (id: string) => { setBusyId(id); start(async () => { await updateProposalStage(id, "失注"); router.refresh(); setBusyId(null); }); };
  const toEngage = (id: string) => { setBusyId(id); start(async () => { await convertToEngagement(id); router.refresh(); setBusyId(null); }); };

  const byStage = (s: string) => proposals.filter((p) => (p.stage ?? "新規提案") === s);

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`, gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {STAGES.map((stage) => {
        const items = byStage(stage);
        const tone = STAGE_TONE[stage] ?? "#6b7280";
        return (
          <div key={stage}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={() => { if (dragId) { move(dragId, stage); setDragId(null); } }}
            style={{ background: "var(--color-surface-soft)", borderRadius: 12, padding: 10, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />{stage}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{items.length}</span>
            </div>

            {items.length === 0 && <div style={{ fontSize: 11, color: "var(--color-ink-4)", textAlign: "center", padding: "16px 0" }}>—</div>}

            {items.map((p) => {
              const idx = STAGES.indexOf(stage);
              const busy = busyId === p.id && pending;
              return (
                <div key={p.id} draggable onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)}
                  className="card" style={{ padding: 12, cursor: "grab", opacity: busy ? 0.5 : 1, borderLeft: `3px solid ${tone}` }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 4 }}>{p.job_title ?? "—"}</div>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{p.company ?? ""}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate_name ?? "—"}</div>
                      <div className="muted" style={{ fontSize: 10.5 }}>{p.rate ?? ""}{p.score != null ? ` · マッチ${p.score}%` : ""}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button type="button" className="btn ghost btn-xs" disabled={idx <= 0 || busy} onClick={() => move(p.id, STAGES[idx - 1])} title="前のステージ">←</button>
                    <button type="button" className="btn ghost btn-xs" disabled={idx >= STAGES.length - 1 || busy} onClick={() => move(p.id, STAGES[idx + 1])} title="次のステージ">→</button>
                    {stage === "成約"
                      ? <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => toEngage(p.id)}>稼働化</button>
                      : <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => lose(p.id)} style={{ color: "var(--color-danger)" }}>失注</button>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
