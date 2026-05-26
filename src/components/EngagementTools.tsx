"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, rowsToCsv, downloadCsv } from "@/lib/csv";
import { createEngagement, importEngagements, type EngagementInput } from "@/lib/actions";
import { Icons } from "./icons";

// CSVヘッダ → フィールドのマッピング（表記ゆれ吸収）
const COL: Record<string, keyof EngagementInput> = {
  "案件名": "job_title", "案件": "job_title", "ポジション": "job_title",
  "企業": "company", "会社": "company", "会社名": "company", "クライアント": "company",
  "氏名": "candidate_name", "名前": "candidate_name", "人材": "candidate_name", "エンジニア": "candidate_name",
  "月額": "monthly_rate", "月額(万)": "monthly_rate", "単価": "monthly_rate", "売上": "monthly_rate",
  "原価": "cost", "原価(万)": "cost", "支払": "cost", "支払額": "cost",
  "所属区分": "affiliation", "区分": "affiliation", "雇用形態": "affiliation",
  "ステータス": "status", "状態": "status", "稼働状態": "status",
  "開始日": "start_date", "稼働開始": "start_date", "満了日": "end_date", "終了日": "end_date",
  "清算下限": "settle_min", "精算下限": "settle_min", "清算上限": "settle_max", "精算上限": "settle_max",
  "当月稼働": "work_hours", "稼働時間": "work_hours",
  "契約書": "contract_status", "注文書": "po_status",
  "更新期限": "renewal_due", "更新ステータス": "renewal_status",
};

const EXPORT_HEADERS = [
  { key: "job_title", label: "案件名" }, { key: "company", label: "企業" }, { key: "candidate_name", label: "氏名" },
  { key: "monthly_rate", label: "月額(万)" }, { key: "cost", label: "原価(万)" }, { key: "affiliation", label: "所属区分" },
  { key: "status", label: "ステータス" }, { key: "start_date", label: "開始日" }, { key: "end_date", label: "満了日" },
  { key: "settle_min", label: "清算下限" }, { key: "settle_max", label: "清算上限" }, { key: "work_hours", label: "当月稼働" },
  { key: "contract_status", label: "契約書" }, { key: "po_status", label: "注文書" }, { key: "renewal_due", label: "更新期限" }, { key: "renewal_status", label: "更新ステータス" },
];

const TEMPLATE = ["案件名", "企業", "氏名", "月額(万)", "原価(万)", "所属区分", "ステータス", "開始日", "満了日", "清算下限", "清算上限", "当月稼働", "契約書", "注文書", "更新期限", "更新ステータス"];

const STATUSES = ["予定", "稼働中", "終了"];
const AFFILIATIONS = ["PP", "BP", "FL"];
const d10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");

export function EngagementTools({ rows }: { rows: any[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<{ recs: EngagementInput[]; fileName: string } | null>(null);
  const [showNew, setShowNew] = useState(false);

  // エクスポート用に日付を整形
  const exportRows = rows.map((r) => ({ ...r, start_date: d10(r.start_date), end_date: d10(r.end_date), renewal_due: d10(r.renewal_due) }));

  const onFile = async (file: File) => {
    setMsg(null);
    const grid = parseCsv(await file.text());
    if (grid.length < 2) { setMsg({ ok: false, text: "データ行がありません" }); return; }
    const header = grid[0].map((h) => h.trim());
    const recs: EngagementInput[] = grid.slice(1).filter((c) => c.some((x) => (x || "").trim())).map((cols) => {
      const rec: EngagementInput = {};
      header.forEach((h, i) => { const key = COL[h]; if (key) (rec as any)[key] = (cols[i] ?? "").trim(); });
      return rec;
    }).filter((r) => r.job_title || r.candidate_name || r.company);
    if (recs.length === 0) { setMsg({ ok: false, text: "取込対象がありません（案件名・企業・氏名のいずれか必須）" }); return; }
    setPreview({ recs, fileName: file.name });
  };

  const doImport = () => {
    if (!preview) return;
    start(async () => {
      const res = await importEngagements(preview.recs);
      if (res.ok) { setMsg({ ok: true, text: `${res.inserted} 件を取り込みました` }); setPreview(null); router.refresh(); }
      else { setMsg({ ok: false, text: res.error || "取込に失敗しました" }); setPreview(null); }
    });
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
      <button className="btn brand" disabled={pending} onClick={() => setShowNew((v) => !v)}><Icons.plus /><span>{showNew ? "閉じる" : "新規追加"}</span></button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
      <button className="btn" disabled={pending} onClick={() => fileRef.current?.click()}><Icons.plus /><span>{pending ? "取込中…" : "CSV取込"}</span></button>
      <button className="btn" disabled={exportRows.length === 0} onClick={() => downloadCsv(`稼働管理_${new Date().toISOString().slice(0, 10)}.csv`, rowsToCsv(EXPORT_HEADERS, exportRows))}><Icons.arrow /><span>CSV書き出し</span></button>
      <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => downloadCsv("稼働テンプレート.csv", "﻿" + TEMPLATE.join(",") + "\nReact開発,株式会社サンプル,山田 太郎,80,60,BP,稼働中,2026/06/01,2026/12/31,140,180,160,回収済,送付済,2026/11/30,未着手")}>テンプレ</button>
      {msg && <span style={{ fontSize: 12, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</span>}

      {showNew && <NewEngagementForm onDone={(ok) => { setShowNew(false); if (ok) { setMsg({ ok: true, text: "稼働を追加しました" }); router.refresh(); } }} />}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>稼働CSV取込</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>{preview.fileName} · <b style={{ color: "var(--color-ink)" }}>{preview.recs.length} 件</b> を取り込みます。</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn brand" disabled={pending} onClick={doImport}>{pending ? "取込中…" : `${preview.recs.length} 件を取込`}</button>
              <button className="btn ghost" onClick={() => setPreview(null)}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
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
