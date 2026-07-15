"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClientJob } from "@/app/portal/actions";

// #425：案件登録の契約種別は契約形態（準委任／派遣）で選ばせる（従来の業態 SES/紹介/派遣 から変更）。
const CONTRACT_TYPES = ["準委任", "派遣"] as const;
const REMOTE = [{ v: "full_remote", l: "フルリモート" }, { v: "partial_remote", l: "一部リモート" }, { v: "onsite", l: "出社" }];

export function ClientJobForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", role_label: "", skillsText: "", salary_min: "", salary_max: "", remote_type: "", description: "" });
  const [cts, setCts] = useState<string[]>([]);

  const toggleCt = (c: string) => setCts((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = () => {
    if (!f.title.trim()) { setErr("案件名を入力してください"); return; }
    setErr(null);
    start(async () => {
      const res = await createClientJob({
        title: f.title,
        role_label: f.role_label,
        skills: f.skillsText.split(/[、,\s]+/).map((s) => s.trim()).filter(Boolean),
        salary_min: f.salary_min ? Number(f.salary_min) * 10000 : null,
        salary_max: f.salary_max ? Number(f.salary_max) * 10000 : null,
        remote_type: f.remote_type,
        contract_types: cts,
        description: f.description,
      });
      if (!res.ok) { setErr(res.error || "登録に失敗しました"); return; }
      setF({ title: "", role_label: "", skillsText: "", salary_min: "", salary_max: "", remote_type: "", description: "" });
      setCts([]); setOpen(false);
      router.refresh();
    });
  };

  const inp = { width: "100%", padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 9, fontSize: 13.5, fontFamily: "inherit", background: "#fff", outline: "none" } as const;
  const lbl = { fontSize: 12, fontWeight: 700, color: "var(--color-ink-2)", marginBottom: 5, display: "block" } as const;

  if (!open) {
    return (
      <button className="btn brand" onClick={() => setOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>案件を掲載する
      </button>
    );
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--color-brand-200)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>案件を掲載</h3>
        <button className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
      </div>
      <div><label style={lbl}>案件名 <span style={{ color: "#dc2626" }}>*</span></label><input style={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="例：React/Next.js フロントエンド開発" /></div>
      <div><label style={lbl}>職種</label><input style={inp} value={f.role_label} onChange={(e) => set("role_label", e.target.value)} placeholder="例：フロントエンドエンジニア" /></div>
      <div><label style={lbl}>必要スキル（カンマ区切り）</label><input style={inp} value={f.skillsText} onChange={(e) => set("skillsText", e.target.value)} placeholder="React, TypeScript, AWS" /></div>

      <div>
        <label style={lbl}>契約種別（複数選択可）</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CONTRACT_TYPES.map((c) => (
            <button key={c} type="button" onClick={() => toggleCt(c)} className="tag" style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "6px 14px", border: cts.includes(c) ? "1.5px solid var(--color-brand-600)" : "1px solid var(--color-border)", background: cts.includes(c) ? "var(--color-brand-600)" : "var(--color-surface)", color: cts.includes(c) ? "#fff" : "var(--color-ink-2)" }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 120px" }}><label style={lbl}>単価 下限（万/月）</label><input type="number" style={inp} value={f.salary_min} onChange={(e) => set("salary_min", e.target.value)} placeholder="60" /></div>
        <div style={{ flex: "1 1 120px" }}><label style={lbl}>単価 上限（万/月）</label><input type="number" style={inp} value={f.salary_max} onChange={(e) => set("salary_max", e.target.value)} placeholder="90" /></div>
        <div style={{ flex: "1 1 140px" }}><label style={lbl}>勤務形態</label>
          <select style={inp} value={f.remote_type} onChange={(e) => set("remote_type", e.target.value)}>
            <option value="">指定なし</option>
            {REMOTE.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </div>
      </div>

      <div><label style={lbl}>案件詳細</label><textarea style={{ ...inp, resize: "vertical" }} rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="業務内容・体制・求める人物像など" /></div>

      {err && <div style={{ fontSize: 12.5, color: "#b42318" }}>{err}</div>}
      <div className="muted" style={{ fontSize: 11.5 }}>※ 掲載後は「審査中」となり、運営の承認後に人材へ公開されます。</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn brand" disabled={pending} onClick={submit}>{pending ? "送信中…" : "掲載を申請する"}</button>
      </div>
    </div>
  );
}
