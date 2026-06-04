"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import { createEngagement, type EngagementInput } from "@/lib/actions";
import { Icons } from "./icons";

const EXPORT_HEADERS = [
  { key: "job_title", label: "案件名" }, { key: "company", label: "企業" }, { key: "candidate_name", label: "氏名" },
  { key: "monthly_rate", label: "月額(万)" }, { key: "cost", label: "原価(万)" }, { key: "affiliation", label: "所属区分" },
  { key: "status", label: "ステータス" }, { key: "start_date", label: "開始日" }, { key: "end_date", label: "満了日" },
  { key: "settle_min", label: "清算下限" }, { key: "settle_max", label: "清算上限" }, { key: "work_hours", label: "当月稼働" },
  { key: "contract_status", label: "契約書" }, { key: "po_status", label: "注文書" }, { key: "renewal_due", label: "更新期限" }, { key: "renewal_status", label: "更新ステータス" },
  { key: "board_project_id", label: "board案件No" },
];

const STATUSES = ["予定", "稼働中", "終了"];
const AFFILIATIONS = ["PP", "BP", "FL"];
const d10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export function EngagementTools({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showNew, setShowNew] = useState(false);

  // エクスポート用に日付を整形
  const exportRows = rows.map((r) => ({ ...r, start_date: d10(r.start_date), end_date: d10(r.end_date), renewal_due: d10(r.renewal_due) }));

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
      <button className="btn brand" disabled={pending} onClick={() => setShowNew((v) => !v)}><Icons.plus /><span>{showNew ? "閉じる" : "新規追加"}</span></button>
      <button className="btn" disabled={exportRows.length === 0} onClick={() => downloadCsv(`稼働管理_${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(EXPORT_HEADERS, exportRows))}><Icons.arrow /><span>CSV書き出し</span></button>
      {msg && <span style={{ fontSize: 12, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</span>}

      {showNew && <NewEngagementForm onDone={(ok) => { setShowNew(false); if (ok) { setMsg({ ok: true, text: "稼働を追加しました" }); router.refresh(); } }} />}
    </div>
  );
}

function NewEngagementForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const [f, setF] = useState<EngagementInput>({ status: "予定" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof EngagementInput, v: any) => setF((p) => ({ ...p, [k]: v }));
  const inp = { fontFamily: "inherit", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
  const L = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 3 }}>{children}</div>;

  const submit = async () => {
    if (!f.job_title && !f.candidate_name && !f.company) { setErr("案件名・企業・氏名のいずれかを入力してください"); return; }
    setSaving(true); setErr(null);
    const res = await createEngagement(f);
    setSaving(false);
    if (res.ok) onDone(true); else setErr(res.error || "保存に失敗しました");
  };

  return (
    <div onClick={() => onDone(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 600, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>稼働を新規追加</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <div><L>案件名</L><input style={inp} value={f.job_title ?? ""} onChange={(e) => set("job_title", e.target.value)} placeholder="React開発" /></div>
          <div><L>企業</L><input style={inp} value={f.company ?? ""} onChange={(e) => set("company", e.target.value)} placeholder="株式会社〇〇" /></div>
          <div><L>氏名</L><input style={inp} value={f.candidate_name ?? ""} onChange={(e) => set("candidate_name", e.target.value)} placeholder="山田 太郎" /></div>
          <div><L>所属区分</L><select style={inp} value={f.affiliation ?? ""} onChange={(e) => set("affiliation", e.target.value)}><option value="">未設定</option>{AFFILIATIONS.map((a) => <option key={a}>{a}</option>)}</select></div>
          <div><L>月額(万)</L><input style={inp} type="number" value={f.monthly_rate ?? ""} onChange={(e) => set("monthly_rate", e.target.value)} /></div>
          <div><L>原価(万)</L><input style={inp} type="number" value={f.cost ?? ""} onChange={(e) => set("cost", e.target.value)} /></div>
          <div><L>ステータス</L><select style={inp} value={f.status ?? "予定"} onChange={(e) => set("status", e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><L>開始日</L><input style={inp} type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} /></div>
          <div><L>満了日</L><input style={inp} type="date" value={f.end_date ?? ""} onChange={(e) => set("end_date", e.target.value)} /></div>
          <div style={{ gridColumn: "1 / -1" }}>
            <L>board案件No（任意・最初に紐付けると請求書送付状況が自動同期されます）</L>
            <input style={inp} value={(f as any).board_project_id ?? ""} onChange={(e) => set("board_project_id" as any, e.target.value)} placeholder="例: 11177（board の案件No を入力）" />
          </div>
        </div>
        {err && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn brand" disabled={saving} onClick={submit}>{saving ? "保存中…" : "追加する"}</button>
          <button type="button" className="btn ghost" onClick={() => onDone(false)}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}
