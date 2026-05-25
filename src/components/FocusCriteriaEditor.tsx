"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveFocusCriteria } from "@/app/settings/focus-actions";
import { type FocusCriteria, type FocusRule, splitList } from "@/lib/focus-criteria";

const inp = { fontFamily: "inherit", fontSize: 13, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
const L = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 4 }}>{children}</div>;

function RuleForm({ title, hint, rule, onChange }: { title: string; hint: string; rule: FocusRule; onChange: (r: FocusRule) => void }) {
  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div><b style={{ fontSize: 13.5 }}>{title}</b><div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><L>単価下限（万）</L><input style={inp} type="number" value={rule.minRate ?? ""} onChange={(e) => onChange({ ...rule, minRate: e.target.value === "" ? null : Number(e.target.value) })} placeholder="例：70" /></div>
        <div><L>重視スキル（カンマ区切り・いずれか合致）</L><input style={inp} value={rule.skills.join(", ")} onChange={(e) => onChange({ ...rule, skills: splitList(e.target.value) })} placeholder="React, AWS, Go" /></div>
        <div><L>重視キーワード（カンマ区切り・いずれか含む）</L><input style={inp} value={rule.keywords.join(", ")} onChange={(e) => onChange({ ...rule, keywords: splitList(e.target.value) })} placeholder="リモート, PM, 即日" /></div>
      </div>
      <div><L>注力方針メモ（アラートに表示）</L><textarea style={{ ...inp, resize: "vertical" }} rows={2} value={rule.note} onChange={(e) => onChange({ ...rule, note: e.target.value })} placeholder="例：高単価×即戦力を優先。低単価案件は注力しない。" /></div>
    </div>
  );
}

export function FocusCriteriaEditor({ initial }: { initial: FocusCriteria }) {
  const router = useRouter();
  const [c, setC] = useState<FocusCriteria>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true); setMsg(null);
    const res = await saveFocusCriteria(c);
    setSaving(false);
    setMsg(res.ok ? { ok: true, text: "保存しました" } : { ok: false, text: res.error ?? "保存に失敗しました" });
    if (res.ok) router.refresh();
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>⭐ 注力（お気に入り）の定義</h3>
        <span className="muted" style={{ fontSize: 11 }}>人材・案件をお気に入り登録する際、この定義との合致をチェックします</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <RuleForm title="人材の注力定義" hint="人材をお気に入りにする時の判定条件" rule={c.candidates} onChange={(r) => setC({ ...c, candidates: r })} />
        <RuleForm title="案件の注力定義" hint="案件をお気に入りにする時の判定条件" rule={c.jobs} onChange={(r) => setC({ ...c, jobs: r })} />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn brand" disabled={saving} onClick={save}>{saving ? "保存中…" : "注力定義を保存"}</button>
          {msg && <span style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
