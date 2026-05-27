"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDocumentTask, updateDocumentTask, deleteDocumentTask, type DocumentTaskInput } from "@/lib/actions";
import { Icons } from "./icons";

const PARTIES = ["上位", "下位"];
const DOC_TYPES = ["契約書", "基本契約書", "個別契約書", "注文書", "注文請書", "秘密保持契約書", "その他"];
const STATUSES = ["未送付", "送付済", "完了"];
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  未送付: { bg: "#fdecec", fg: "#d23f57" }, 送付済: { bg: "#fef6e0", fg: "#9a7b12" }, 完了: { bg: "#e7f3ea", fg: "#1aa260" },
};
const PARTY_TONE: Record<string, { bg: string; fg: string }> = {
  上位: { bg: "#eaf2fb", fg: "#0b5cab" }, 下位: { bg: "#f3eefb", fg: "#6b46c1" },
};

const DAY = 86400000;
const dateVal = (d?: string | null) => (d ? String(d).slice(0, 10) : "");
const daysUntil = (d?: string | null) => {
  if (!d) return null;
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  return Math.floor((new Date(d).getTime() - t0.getTime()) / DAY);
};

const inp = { fontFamily: "inherit", fontSize: 12, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%", boxSizing: "border-box" } as const;
const th = { padding: "8px", textAlign: "left", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap", borderBottom: "2px solid var(--color-border)" } as const;
const td = { padding: "7px 8px", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" } as const;
const L = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 3 }}>{children}</div>;

type Doc = { id: string; party?: string | null; counterparty?: string | null; subject?: string | null; doc_type?: string | null; due_date?: string | null; status?: string | null; note?: string | null };

const isDone = (d: Doc) => d.status === "完了";

export function DocumentTasks({ rows, canManage }: { rows: Doc[]; canManage: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const onChanged = () => router.refresh();

  const searched = useMemo(() => rows.filter((d) => {
    const t = q.trim();
    if (!t) return true;
    return [d.counterparty, d.subject, d.doc_type, d.note].some((v) => (v ?? "").includes(t));
  }), [rows, q]);
  const doneCount = useMemo(() => searched.filter(isDone).length, [searched]);
  const visible = showDone ? searched : searched.filter((d) => !isDone(d));

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {canManage && <button className="btn brand" onClick={() => setShowNew(true)}><Icons.plus /><span>書類を追加</span></button>}
        <div className="tbl-search" style={{ width: 200, flex: "0 0 200px" }}><input placeholder="相手先・関連・書類で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button onClick={() => setShowDone((v) => !v)} title="完了した書類" style={{ padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${showDone ? "#1aa260" : "var(--color-border-strong)"}`, background: showDone ? "#e7f3ea" : "var(--color-surface)", color: showDone ? "#067647" : "var(--color-ink-3)" }}>✓ 完了 {doneCount}{showDone ? "（表示中）" : "（非表示）"}</button>
      </div>

      {visible.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
          {searched.length > 0 && doneCount > 0 ? <>未完了の書類はありません 🎉 「✓ 完了 {doneCount}」で完了分を表示できます。</>
            : canManage ? <>書類送付タスクがありません。「＋ 書類を追加」で登録してください。</>
            : <>書類送付タスクがありません。</>}
        </div>
      ) : (
        <div className="card flush" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>相手</th><th style={th}>相手先</th><th style={th}>関連（案件/人材）</th><th style={th}>書類種別</th><th style={th}>送付期限</th><th style={th}>状況</th><th style={th}>メモ</th>{canManage && <th style={th}></th>}
              </tr>
            </thead>
            <tbody>{visible.map((d) => <DocRow key={d.id} d={d} canManage={canManage} onChanged={onChanged} />)}</tbody>
          </table>
        </div>
      )}

      {showNew && <NewDocForm onDone={(ok) => { setShowNew(false); if (ok) router.refresh(); }} />}
    </>
  );
}

function DueCell({ value, disabled, onSave }: { value?: string | null; disabled: boolean; onSave: (v: string | null) => void }) {
  const d = daysUntil(value);
  const overdue = d != null && d < 0;
  const soon = d != null && d >= 0 && d <= 7;
  const color = overdue ? "#b42318" : soon ? "#b45309" : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 128 }}>
      <input type="date" defaultValue={dateVal(value)} disabled={disabled} style={{ ...inp, width: 128, color, fontWeight: overdue || soon ? 700 : 400 }} onBlur={(ev) => { if (ev.target.value !== dateVal(value)) onSave(ev.target.value || null); }} />
      {d != null && (overdue ? <span style={{ fontSize: 10, color: "#b42318", fontWeight: 700 }}>⚠ {-d}日超過</span> : soon ? <span style={{ fontSize: 10, color: "#b45309", fontWeight: 700 }}>あと{d}日</span> : null)}
    </div>
  );
}

function DocRow({ d, canManage, onChanged }: { d: Doc; canManage: boolean; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const save = (patch: DocumentTaskInput) => start(async () => { await updateDocumentTask(d.id, patch); onChanged(); });
  const remove = () => { if (!confirm("この書類タスクを削除しますか？")) return; start(async () => { await deleteDocumentTask(d.id); onChanged(); }); };
  const sTone = STATUS_TONE[d.status ?? "未送付"] ?? STATUS_TONE["未送付"];
  const pTone = PARTY_TONE[d.party ?? "上位"] ?? PARTY_TONE["上位"];

  if (!canManage) {
    return (
      <tr>
        <td style={td}><span style={{ padding: "2px 8px", borderRadius: 99, background: pTone.bg, color: pTone.fg, fontSize: 11, fontWeight: 700 }}>{d.party ?? "—"}</span></td>
        <td style={td}>{d.counterparty ?? "—"}</td>
        <td style={td}>{d.subject ?? "—"}</td>
        <td style={td}>{d.doc_type ?? "—"}</td>
        <td style={td}>{dateVal(d.due_date) || "—"}</td>
        <td style={td}><span style={{ padding: "2px 8px", borderRadius: 99, background: sTone.bg, color: sTone.fg, fontSize: 11, fontWeight: 700 }}>{d.status ?? "未送付"}</span></td>
        <td style={td}>{d.note ?? ""}</td>
      </tr>
    );
  }

  return (
    <tr style={{ opacity: pending ? 0.6 : 1 }}>
      <td style={td}><select defaultValue={d.party ?? "上位"} disabled={pending} style={{ ...inp, width: 74, background: pTone.bg, color: pTone.fg, fontWeight: 700 }} onChange={(ev) => save({ party: ev.target.value })}>{PARTIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></td>
      <td style={td}><input defaultValue={d.counterparty ?? ""} placeholder="相手企業" disabled={pending} style={{ ...inp, minWidth: 120 }} onBlur={(ev) => { if (ev.target.value !== (d.counterparty ?? "")) save({ counterparty: ev.target.value }); }} /></td>
      <td style={td}><input defaultValue={d.subject ?? ""} placeholder="案件/人材など" disabled={pending} style={{ ...inp, minWidth: 130 }} onBlur={(ev) => { if (ev.target.value !== (d.subject ?? "")) save({ subject: ev.target.value }); }} /></td>
      <td style={td}><select defaultValue={d.doc_type ?? "契約書"} disabled={pending} style={{ ...inp, width: 128 }} onChange={(ev) => save({ doc_type: ev.target.value })}>{DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
      <td style={td}><DueCell value={d.due_date} disabled={pending} onSave={(v) => save({ due_date: v })} /></td>
      <td style={td}><select defaultValue={d.status ?? "未送付"} disabled={pending} style={{ ...inp, width: 90, background: sTone.bg, color: sTone.fg, fontWeight: 700 }} onChange={(ev) => save({ status: ev.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
      <td style={td}><input defaultValue={d.note ?? ""} placeholder="メモ" disabled={pending} style={{ ...inp, minWidth: 140 }} onBlur={(ev) => { if (ev.target.value !== (d.note ?? "")) save({ note: ev.target.value }); }} /></td>
      <td style={td}><button type="button" className="btn ghost btn-xs" disabled={pending} title="削除" onClick={remove} style={{ color: "#b42318" }}>✕</button></td>
    </tr>
  );
}

function NewDocForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const [f, setF] = useState<DocumentTaskInput>({ party: "上位", doc_type: "契約書", status: "未送付" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof DocumentTaskInput, v: any) => setF((p) => ({ ...p, [k]: v }));
  const fInp = { fontFamily: "inherit", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%", boxSizing: "border-box" } as const;

  const submit = async () => {
    if (!f.counterparty && !f.subject) { setErr("相手先または関連（案件/人材）を入力してください"); return; }
    setSaving(true); setErr(null);
    const res = await createDocumentTask(f);
    setSaving(false);
    if (res.ok) onDone(true); else setErr(res.error || "保存に失敗しました");
  };

  return (
    <div onClick={() => onDone(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>書類送付タスクを追加</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div><L>相手区分</L><select style={fInp} value={f.party ?? "上位"} onChange={(e) => set("party", e.target.value)}>{PARTIES.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div><L>相手先（企業名）</L><input style={fInp} value={f.counterparty ?? ""} onChange={(e) => set("counterparty", e.target.value)} placeholder="株式会社〇〇" /></div>
          <div><L>関連（案件/人材）</L><input style={fInp} value={f.subject ?? ""} onChange={(e) => set("subject", e.target.value)} placeholder="React開発 / 山田 太郎" /></div>
          <div><L>書類種別</L><select style={fInp} value={f.doc_type ?? "契約書"} onChange={(e) => set("doc_type", e.target.value)}>{DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><L>送付期限</L><input style={fInp} type="date" value={f.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} /></div>
          <div><L>状況</L><select style={fInp} value={f.status ?? "未送付"} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        </div>
        <div><L>メモ（任意）</L><input style={fInp} value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} placeholder="基本契約は締結済 など" /></div>
        {err && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn brand" disabled={saving} onClick={submit}>{saving ? "保存中…" : "追加する"}</button>
          <button type="button" className="btn ghost" onClick={() => onDone(false)}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
