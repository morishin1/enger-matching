"use client";

// 提案管理に「新規追加」モーダル。
// 案件・人材は NO で既存参照、または下のフィールドで新規に作成（その場で upsert）して提案を1件登録。
// LINE/書面で来た案件など、まだ enger に取り込んでいないケースも入口を1つで処理できる。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProposalManual } from "@/lib/actions";
import { Icons } from "./icons";

const STAGES = ["未対応", "提案中", "面談調整", "クロージング中", "面談合格"];

const fieldStyle: React.CSSProperties = { fontSize: 12.5, padding: "6px 8px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", fontFamily: "var(--font-sans)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--color-ink-3)" };

function Field({ label, value, onChange, full, placeholder, type = "text" }: { label: string; value?: string; onChange: (v: string) => void; full?: boolean; placeholder?: string; type?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={labelStyle}>{label}</span>
      <input type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={fieldStyle} />
    </label>
  );
}
function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={fieldStyle}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
function Textarea({ label, value, onChange }: { label: string; value?: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
      <span style={labelStyle}>{label}</span>
      <textarea value={value ?? ""} rows={3} onChange={(e) => onChange(e.target.value)} style={{ ...fieldStyle, resize: "vertical", padding: "8px" }} />
    </label>
  );
}

export function NewProposalButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const close = () => { if (!pending) { setOpen(false); setMsg(null); setF({}); } };

  const submit = () => {
    setMsg(null);
    const parseNum = (v?: string) => { const n = parseInt((v || "").replace(/[^\d]/g, ""), 10); return Number.isFinite(n) && n > 0 ? n : undefined; };
    start(async () => {
      const res = await createProposalManual({
        job: { job_no: parseNum(f.job_no), title: f.job_title || null, client_name: f.client_name || null },
        candidate: { candidate_no: parseNum(f.cand_no), name: f.cand_name || null, company: f.cand_company || null, rate: f.cand_rate || null },
        stage: f.stage || undefined,
        proposer: f.proposer,
        partner: f.partner,
        closer: f.closer,
        client_contact: f.client_contact,
        meeting_date: f.meeting_date,
        note: f.note,
      });
      if (res.ok) {
        const j = `No.${String(res.job_no ?? 0).padStart(5, "0")}`;
        const c = `P-${String(res.candidate_no ?? 0).padStart(5, "0")}`;
        const lbl = res.action === "existed"
          ? `既に同じ提案があります（${j} × ${c}）`
          : `提案を追加しました（${j} × ${c}）`;
        setMsg({ ok: true, text: lbl });
        router.refresh();
        if (res.action !== "existed") setTimeout(close, 900);
      } else setMsg({ ok: false, text: res.error || "追加に失敗しました" });
    });
  };

  return (
    <>
      <button className="btn brand" onClick={() => setOpen(true)}><Icons.plus /><span>新規追加</span></button>
      {open && (
        <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>提案を新規追加</h3>
              <button className="btn ghost btn-xs" onClick={close} disabled={pending}>閉じる</button>
            </div>
            <div className="muted" style={{ fontSize: 11.5 }}>
              既存の案件・人材は「NO」を入力。新規（LINE/書面など）は下のフィールドに入力すると自動でマスタに追加されます。
            </div>

            {/* 案件 */}
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-2)" }}>案件</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                <Field label="案件NO（既存から）" value={f.job_no} onChange={set("job_no")} placeholder="例：123（または空欄）" />
                <div />
                <Field label="案件名（新規作成時）" value={f.job_title} onChange={set("job_title")} placeholder="既存NO未指定の場合に入力" />
                <Field label="クライアント名" value={f.client_name} onChange={set("client_name")} />
              </div>
            </div>

            {/* 人材 */}
            <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-ink-2)" }}>人材</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                <Field label="人材NO（既存から）" value={f.cand_no} onChange={set("cand_no")} placeholder="例：456（または空欄）" />
                <Field label="希望単価" value={f.cand_rate} onChange={set("cand_rate")} placeholder="例：80万 / ¥70〜90万" />
                <Field label="氏名（新規作成時）" value={f.cand_name} onChange={set("cand_name")} placeholder="既存NO未指定の場合に入力" />
                <Field label="所属会社" value={f.cand_company} onChange={set("cand_company")} />
              </div>
            </div>

            {/* 提案メタ */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <Select label="ステージ" value={f.stage} onChange={set("stage")} options={STAGES.map((s) => ({ value: s, label: s }))} />
              <Field label="面談予定日" value={f.meeting_date} onChange={set("meeting_date")} placeholder="例：2026/06/15" />
              <Field label="提案者" value={f.proposer} onChange={set("proposer")} />
              <Field label="パートナー" value={f.partner} onChange={set("partner")} />
              <Field label="クロージング担当" value={f.closer} onChange={set("closer")} />
              <Field label="企業担当者" value={f.client_contact} onChange={set("client_contact")} />
              <Textarea label="メモ（次アクション）" value={f.note} onChange={set("note")} />
            </div>

            {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={close} disabled={pending}>キャンセル</button>
              <button className="btn brand" onClick={submit} disabled={pending}>{pending ? "追加中…" : "提案を追加"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
