"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, updateProposalFields } from "@/lib/actions";
import { PROPOSAL_STAGES, CALLER_STATUSES, PROPOSERS, CLOSERS, LOST_PHASES, LOST_REASONS } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  未対応: "#6b7280", 提案中: "#0095D9", 面談調整: "#d98a2b", クロージング中: "#e0567f", 稼働決定: "#1aa260",
};
const CALLER_TONE: Record<string, string> = {
  返信あり: "#1aa260", 電話済み: "#0095D9", "電話(不在)": "#d98a2b", LINE確認中: "#7c5cff", メール確認中: "#7c5cff", 未架電: "#9aa7b4",
};

function Field({ label, value, options, onChange, placeholder }: { label: string; value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
        <option value="">{placeholder ?? "—"}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Card({ p, stageIdx, onMove, onLose, onEngage, onSave, busy, proposers, closers }: any) {
  const [open, setOpen] = useState(false);
  const [caller, setCaller] = useState(p.caller_status ?? "");
  const [proposer, setProposer] = useState(p.proposer ?? "");
  const [closer, setCloser] = useState(p.closer ?? "");
  const [lostPhase, setLostPhase] = useState(p.lost_phase ?? "");
  const [lostReason, setLostReason] = useState(p.lost_reason ?? "");
  const tone = STAGE_TONE[p.stage] ?? "#6b7280";

  return (
    <div className="card" style={{ padding: 12, opacity: busy ? 0.5 : 1, borderLeft: `3px solid ${tone}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 3 }}>{p.job_title ?? "—"}</div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{p.company ?? ""}{p.client_contact ? ` / ${p.client_contact}` : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate_name ?? "—"}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>{p.rate ?? ""}{p.score != null ? ` · マッチ${p.score}%` : ""}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {p.caller_status && <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: `${CALLER_TONE[p.caller_status] ?? "#9aa7b4"}1a`, color: CALLER_TONE[p.caller_status] ?? "var(--color-ink-3)" }}>☎ {p.caller_status}</span>}
        {p.proposer && <span className="tag" style={{ fontSize: 10 }}>提案 {p.proposer}</span>}
        {p.closer && p.closer !== "未割当" && <span className="tag" style={{ fontSize: 10 }}>CL {p.closer}</span>}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn ghost btn-xs" disabled={stageIdx <= 0 || busy} onClick={() => onMove(p.id, STAGES[stageIdx - 1])} title="前へ">←</button>
        <button type="button" className="btn ghost btn-xs" disabled={stageIdx >= STAGES.length - 1 || busy} onClick={() => onMove(p.id, STAGES[stageIdx + 1])} title="次へ">→</button>
        {p.stage === "稼働決定" && <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => onEngage(p.id)}>稼働化</button>}
        <button type="button" className="btn ghost btn-xs" onClick={() => setOpen((v) => !v)} style={{ marginLeft: "auto" }}>{open ? "閉じる" : "編集"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="架電進捗" value={caller} options={CALLER_STATUSES} onChange={setCaller} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Field label="提案者" value={proposer} options={proposers ?? PROPOSERS} onChange={setProposer} />
            <Field label="クロージング" value={closer} options={closers ?? CLOSERS} onChange={setCloser} />
          </div>
          <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => onSave(p.id, { caller_status: caller, proposer, closer })}>保存</button>

          <div style={{ paddingTop: 8, borderTop: "1px dashed var(--color-border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10.5, color: "var(--color-danger)", fontWeight: 600 }}>見送り（失注）</div>
            <Field label="失注フェーズ" value={lostPhase} options={LOST_PHASES} onChange={setLostPhase} />
            <Field label="失注理由（主要因）" value={lostReason} options={LOST_REASONS} onChange={setLostReason} />
            <button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)" }} disabled={busy} onClick={() => onLose(p.id, lostPhase, lostReason)}>見送りにする</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProposalBoard({ proposals, proposers, closers }: { proposals: any[]; proposers?: string[]; closers?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = (id: string, fn: () => Promise<any>) => { setBusyId(id); start(async () => { await fn(); router.refresh(); setBusyId(null); }); };
  const onMove = (id: string, stage: string) => run(id, () => updateProposalStage(id, stage));
  const onEngage = (id: string) => run(id, () => convertToEngagement(id));
  const onSave = (id: string, fields: any) => run(id, () => updateProposalFields(id, fields));
  const onLose = (id: string, lost_phase: string, lost_reason: string) => run(id, () => updateProposalFields(id, { stage: "見送り", lost_phase, lost_reason }));

  const byStage = (s: string) => proposals.filter((p) => (p.stage ?? "未対応") === s);

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(230px, 1fr))`, gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {STAGES.map((stage) => {
        const items = byStage(stage);
        const tone = STAGE_TONE[stage] ?? "#6b7280";
        return (
          <div key={stage} style={{ background: "var(--color-surface-soft)", borderRadius: 12, padding: 10, minWidth: 230, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />{stage}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{items.length}</span>
            </div>
            {items.length === 0 && <div style={{ fontSize: 11, color: "var(--color-ink-4)", textAlign: "center", padding: "16px 0" }}>—</div>}
            {items.map((p) => (
              <Card key={p.id} p={p} stageIdx={STAGES.indexOf(stage)} busy={busyId === p.id && pending} proposers={proposers} closers={closers}
                onMove={onMove} onLose={onLose} onEngage={onEngage} onSave={onSave} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
