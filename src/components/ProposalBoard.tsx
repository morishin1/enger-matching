"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateProposalStage, convertToEngagement, updateProposalFields, deleteProposal } from "@/lib/actions";

const dvDate = (d: any) => { if (!d) return ""; const t = new Date(d); return isNaN(t.getTime()) ? "" : `${t.getMonth() + 1}/${t.getDate()}`; };
const dvDateTime = (d: any) => {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

// 提案者名を見分けやすくする安定色（同じ名前は同じ色）。
const PROPOSER_PALETTE = ["#0b5cab", "#7c3aed", "#1aa260", "#d97706", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#475569", "#ea580c", "#4338ca", "#0d9488"];
function hashColor(name?: string | null): string {
  if (!name) return "#9aa7b4";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROPOSER_PALETTE[h % PROPOSER_PALETTE.length];
}
import { PROPOSAL_STAGES, CALLER_STATUSES, MEETING_STATUSES, PROPOSERS, LOST_PHASES, LOST_REASONS } from "@/lib/proposal-constants";

const STAGES = [...PROPOSAL_STAGES];
const STAGE_TONE: Record<string, string> = {
  返信待ち: "#6b7280", 提案中: "#0095D9", 面談調整: "#d98a2b", クロージング中: "#e0567f", 面談合格: "#1aa260",
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

function Card({ p, stageIdx, onMove, onLose, onEngage, onSave, onDelete, busy, members, onDragStart, onDragEnd, isDragging }: any) {
  const [open, setOpen] = useState(false);
  const [caller, setCaller] = useState(p.caller_status ?? "");
  const [proposer, setProposer] = useState(p.proposer ?? "");
  const [partner, setPartner] = useState(p.partner ?? "");
  // クロージング担当の既定 = 企業担当（案件の担当者）。未設定なら企業担当を初期表示。
  const [closer, setCloser] = useState(p.closer ?? p.company_owner ?? "");
  const [lostPhase, setLostPhase] = useState(p.lost_phase ?? "");
  const [lostReason, setLostReason] = useState(p.lost_reason ?? "");
  const [meetingDate, setMeetingDate] = useState(p.meeting_date ?? "");
  const [meetingStatus, setMeetingStatus] = useState(p.meeting_status ?? "");
  const tone = STAGE_TONE[p.stage] ?? "#6b7280";

  return (
    <div
      className="card"
      draggable={!busy}
      onDragStart={(e) => { if (busy) { e.preventDefault(); return; } e.dataTransfer.setData("text/proposal-id", p.id); e.dataTransfer.effectAllowed = "move"; onDragStart?.(p.id); }}
      onDragEnd={() => onDragEnd?.()}
      style={{
        padding: 12,
        opacity: busy ? 0.5 : isDragging ? 0.35 : 1,
        borderLeft: `3px solid ${tone}`,
        cursor: busy ? "default" : "grab",
        userSelect: "none",
        transition: "opacity .12s ease",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, marginBottom: 3 }}>
        {p.job_no != null
          ? <Link
              href={p.candidate_no != null ? `/matching?job=${p.job_no}&cand=${p.candidate_no}` : `/matching?job=${p.job_no}`}
              title="この案件×人材のマッチング結果画面へ"
              style={{ color: "var(--color-brand-700)", textDecoration: "none" }}
            >{p.job_title ?? "—"}</Link>
          : (p.job_title ?? "—")}
      </div>
      <div className="muted" style={{ fontSize: 11, marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 6 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.company ?? ""}{p.client_contact ? ` / ${p.client_contact}` : ""}</span>
        {(p.updated_at || p.created_at) && <span style={{ flexShrink: 0 }} title={`登録: ${dvDateTime(p.created_at)}　更新: ${dvDateTime(p.updated_at)}`}>🕒 {dvDateTime(p.updated_at || p.created_at)}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div className="ava" style={{ width: 26, height: 26, fontSize: 10 }}>{p.c_init || (p.candidate_name ?? "?").slice(0, 2)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.candidate_name ?? "—"}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>{p.rate ?? ""}{p.score != null ? ` · マッチ${p.score}%` : ""}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
        {p.caller_status && <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: `${CALLER_TONE[p.caller_status] ?? "#9aa7b4"}1a`, color: CALLER_TONE[p.caller_status] ?? "var(--color-ink-3)" }}>☎ {p.caller_status}</span>}
        {(p.meeting_date || p.meeting_status) && <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: "#fff1e6", color: "#b45309" }}>📅 {[p.meeting_date, p.meeting_status].filter(Boolean).join(" ")}</span>}
        {p.company_owner && <span className="tag" style={{ fontSize: 10, background: "#eef5fd", color: "#0b5cab" }}>企業担当 {p.company_owner}</span>}
        {p.proposer && (() => { const col = hashColor(p.proposer); return (
          <span className="tag" style={{ fontSize: 10, background: `${col}1a`, color: col, border: `1px solid ${col}55`, fontWeight: 700 }}>提案 {p.proposer}</span>
        ); })()}
        {p.partner && (() => { const col = hashColor(p.partner); return (
          <span className="tag" style={{ fontSize: 10, background: `${col}1a`, color: col, border: `1px solid ${col}55` }}>組 {p.partner}</span>
        ); })()}
        {p.proposer && !p.partner && <span className="tag" style={{ fontSize: 10, color: "#b45309", background: "#fff1e6" }}>パートナー未定</span>}
        {(p.closer ?? p.company_owner) && (p.closer ?? p.company_owner) !== "未割当" && (() => { const closer = p.closer ?? p.company_owner; const col = hashColor(closer); return (
          <span className="tag" style={{ fontSize: 10, background: `${col}1a`, color: col, border: `1px solid ${col}55`, fontWeight: 700 }}>CL {closer}</span>
        ); })()}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn ghost btn-xs" disabled={stageIdx <= 0 || busy} onClick={() => onMove(p.id, STAGES[stageIdx - 1])} title="前へ">←</button>
        <button type="button" className="btn ghost btn-xs" disabled={stageIdx >= STAGES.length - 1 || busy} onClick={() => onMove(p.id, STAGES[stageIdx + 1])} title="次へ">→</button>
        {p.stage === "面談合格" && <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => onEngage(p.id)} title="稼働化すると稼働管理へ移り、この一覧から消えます">稼働化 →</button>}
        <button type="button" className="btn ghost btn-xs" onClick={() => setOpen((v) => !v)} style={{ marginLeft: "auto" }}>{open ? "閉じる" : "編集"}</button>
        <button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)" }} disabled={busy} title="この提案を削除（記録ミスの取り消し）" onClick={() => { if (confirm(`「${p.candidate_name ?? "この人材"} × ${p.job_title ?? "案件"}」の提案を削除しますか？\n（記録ミスの取り消し。元に戻せません）`)) onDelete(p.id); }}>🗑</button>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: 8 }}>
          <Field label="架電進捗" value={caller} options={CALLER_STATUSES} onChange={setCaller} />
          {/* 2人1組（提案者＋パートナー）。区分に関係なく全員が担当できる */}
          <div style={{ fontSize: 10.5, color: "#0b5cab", fontWeight: 600 }}>👥 2人1組</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Field label="提案者" value={proposer} options={members ?? PROPOSERS} onChange={setProposer} />
            <Field label="パートナー" value={partner} options={members ?? PROPOSERS} onChange={setPartner} placeholder="相手を選ぶ" />
          </div>
          {/* クロージング担当：企業担当者がデフォルト。提案者・パートナー・他メンバーからも選べる */}
          <Field
            label="クロージング担当"
            value={closer}
            options={Array.from(new Set([p.company_owner, proposer, partner, ...(members ?? PROPOSERS)].filter((x) => x && x !== "")))}
            onChange={setCloser}
            placeholder="未定（あとで決める）"
          />
          <div style={{ fontSize: 10, color: "var(--color-ink-4)" }}>
            {p.company_owner ? <>※ 既定は企業担当の <b>{p.company_owner}</b> さん。ペアで相談して変更できます。</> : <>※ 企業担当が未設定です。案件管理で企業担当を設定すると既定になります。</>}
          </div>
          <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => onSave(p.id, { caller_status: caller, proposer, partner, closer })}>保存</button>

          {/* 面談（これから捌く予定）— ファネルの面談到達率の素 */}
          <div style={{ paddingTop: 8, borderTop: "1px dashed var(--color-border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 600 }}>📅 面談・商談</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, color: "var(--color-ink-4)" }}>予定日
                <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} style={{ fontFamily: "inherit", fontSize: 11.5, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
              </label>
              <Field label="面談ステータス" value={meetingStatus} options={MEETING_STATUSES} onChange={setMeetingStatus} />
            </div>
            <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => onSave(p.id, { meeting_date: meetingDate || null, meeting_status: meetingStatus || null })}>面談情報を保存</button>
          </div>

          <div style={{ paddingTop: 8, borderTop: "1px dashed var(--color-border)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10.5, color: "var(--color-danger)", fontWeight: 600 }}>見送り（失注）</div>
            <Field label="失注フェーズ" value={lostPhase} options={LOST_PHASES} onChange={setLostPhase} />
            <Field label="失注理由（主要因・必須）" value={lostReason} options={LOST_REASONS} onChange={setLostReason} />
            {!lostReason && <div style={{ fontSize: 10, color: "var(--color-danger)" }}>※ 失注理由は分析の必須項目です。選択してください。</div>}
            <button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)", opacity: lostReason ? 1 : 0.5 }} disabled={busy || !lostReason} onClick={() => onLose(p.id, lostPhase, lostReason)}>見送りにする</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProposalBoard({ proposals, members }: { proposals: any[]; members?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const run = (id: string, fn: () => Promise<any>) => { setBusyId(id); start(async () => { await fn(); router.refresh(); setBusyId(null); }); };
  const onMove = (id: string, stage: string) => run(id, () => updateProposalStage(id, stage));
  const onEngage = (id: string) => run(id, () => convertToEngagement(id));
  const onSave = (id: string, fields: any) => run(id, () => updateProposalFields(id, fields));
  const onLose = (id: string, lost_phase: string, lost_reason: string) => run(id, () => updateProposalFields(id, { stage: "見送り", lost_phase, lost_reason }));
  const onDelete = (id: string) => run(id, () => deleteProposal(id));

  const byStage = (s: string) => proposals.filter((p) => (p.stage ?? "返信待ち") === s);

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(230px, 1fr))`, gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {STAGES.map((stage) => {
        const items = byStage(stage);
        const tone = STAGE_TONE[stage] ?? "#6b7280";
        const isOver = overStage === stage && draggingId != null;
        const draggedStage = draggingId ? proposals.find((x) => x.id === draggingId)?.stage : null;
        const isTargetCandidate = draggingId != null && draggedStage !== stage;
        return (
          <div key={stage}
            onDragEnter={(e) => { if (draggingId) { e.preventDefault(); setOverStage(stage); } }}
            onDragOver={(e) => { if (draggingId) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overStage !== stage) setOverStage(stage); } }}
            onDragLeave={(e) => {
              // 子要素間移動でちらつかないよう、要素外に出たときだけクリア
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage((s) => (s === stage ? null : s));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/proposal-id") || draggingId;
              setOverStage(null); setDraggingId(null);
              if (id && draggedStage !== stage) onMove(id, stage);
            }}
            style={{
              background: isOver ? "#fffbeb" : "var(--color-surface-soft)",
              border: isOver ? `2px dashed ${tone}` : isTargetCandidate ? "2px dashed var(--color-border)" : "2px solid transparent",
              borderRadius: 12, padding: 10, minWidth: 230, display: "flex", flexDirection: "column", gap: 8,
              transition: "background .12s ease, border-color .12s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 4px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />{stage}
              </span>
              <span className="muted" style={{ fontSize: 11 }}>{items.length}</span>
            </div>
            {items.length === 0 && <div style={{ fontSize: 11, color: isOver ? tone : "var(--color-ink-4)", textAlign: "center", padding: "16px 0", fontWeight: isOver ? 700 : 400 }}>{isOver ? "ここにドロップ" : "—"}</div>}
            {items.map((p) => (
              <Card key={p.id} p={p} stageIdx={STAGES.indexOf(stage)} busy={busyId === p.id && pending} members={members}
                isDragging={draggingId === p.id}
                onDragStart={(id: string) => setDraggingId(id)}
                onDragEnd={() => { setDraggingId(null); setOverStage(null); }}
                onMove={onMove} onLose={onLose} onEngage={onEngage} onSave={onSave} onDelete={onDelete} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
