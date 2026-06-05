"use client";

// チームKGI 編集フォーム（稼働数ドリブン）。
//   入力：現在の稼働数 / 増やす目標 / 1名あたり平均月額売上 / 1名あたり平均月額粗利 / 許容離脱数
//   表示：目標稼働数・月間売上見込み・月間粗利見込みをリアルタイム算出（稼働数に売上利益が紐づく）

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTeamKgi } from "@/lib/team-kgi-actions";
import { projectKgi, type TeamKgi } from "@/lib/team-kgi";

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const fmtMan = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(2)}億円` : `${Math.round(man).toLocaleString("ja-JP")}万円`);
const fmtDateTime = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function TeamKgiEditor({ department, month, initial }:
  { department: string; month: string; initial: TeamKgi | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [f, setF] = useState({
    active_current: initial?.active_current != null ? String(initial.active_current) : "",
    active_add: initial?.active_add != null ? String(initial.active_add) : "",
    rate_per_head_man: initial?.rate_per_head_man != null ? String(initial.rate_per_head_man) : "",
    gross_per_head_man: initial?.gross_per_head_man != null ? String(initial.gross_per_head_man) : "",
    dropout_allowed: initial?.dropout_allowed != null ? String(initial.dropout_allowed) : "0",
    note: initial?.note ?? "",
  });
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));

  // リアルタイム算出（稼働数 → 売上・利益）
  const proj = useMemo(() => projectKgi({
    active_current: numOrNull(f.active_current),
    active_add: numOrNull(f.active_add),
    rate_per_head_man: numOrNull(f.rate_per_head_man),
    gross_per_head_man: numOrNull(f.gross_per_head_man),
  }), [f.active_current, f.active_add, f.rate_per_head_man, f.gross_per_head_man]);

  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await saveTeamKgi({
        department, month,
        active_current: numOrNull(f.active_current),
        active_add: numOrNull(f.active_add),
        rate_per_head_man: numOrNull(f.rate_per_head_man),
        gross_per_head_man: numOrNull(f.gross_per_head_man),
        dropout_allowed: numOrNull(f.dropout_allowed),
        note: f.note.trim() || null,
      });
      if (res.ok) { setMsg({ ok: true, text: "KGIを保存しました" }); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🎯 稼働数KGI（{department}・{month.slice(0, 7).replace("-", "年")}月）</h3>
        {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.ok ? "✓ " : "⚠ "}{msg.text}</span>}
      </div>

      {/* ① 稼働数（KGIの中心） */}
      <div style={{ border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: 14, marginBottom: 12, background: "var(--color-brand-25)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10, color: "var(--color-brand-700)" }}>稼働数（KGIの中心）</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <Field label="現在の稼働数" unit="名" value={f.active_current} onChange={(v) => set({ active_current: v })} />
          <Field label="今月増やす目標" unit="名" value={f.active_add} onChange={(v) => set({ active_add: v })} placeholder="例: 5" />
          <div style={{ textAlign: "center", padding: "4px 16px", borderRadius: 10, background: "var(--color-surface)", border: "1px solid var(--color-brand-100)" }}>
            <div className="meta">目標稼働数</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: "var(--color-brand-700)" }}>{proj.target}<span style={{ fontSize: 11, marginLeft: 2 }}>名</span></div>
          </div>
        </div>
      </div>

      {/* ② 売上・利益の紐づけ（1名あたり平均） */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>売上・利益の紐づけ（1名あたり平均・月額）</div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 10 }}>チームの平均単価・粗利を入れると、目標稼働数から売上・利益が自動で算出されます。</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="1名あたり平均月額（売上）" unit="万円" value={f.rate_per_head_man} onChange={(v) => set({ rate_per_head_man: v })} placeholder="例: 65" />
          <Field label="1名あたり平均粗利（月額）" unit="万円" value={f.gross_per_head_man} onChange={(v) => set({ gross_per_head_man: v })} placeholder="例: 15" />
        </div>

        {/* 算出結果 */}
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          <div className="kpi brand"><div>
            <div className="val tnum">{fmtMan(proj.monthlyRevenueMan)}</div>
            <div className="label">月間売上見込み（目標稼働時）</div>
            <div className="note">増分: +{fmtMan(proj.addedRevenueMan)}</div>
          </div></div>
          <div className="kpi accent"><div>
            <div className="val tnum">{fmtMan(proj.monthlyGrossMan)}</div>
            <div className="label">月間粗利見込み（目標稼働時）</div>
            <div className="note">増分: +{fmtMan(proj.addedGrossMan)}</div>
          </div></div>
          <div className="kpi"><div>
            <div className="val tnum">{proj.add}<span className="unit">名</span></div>
            <div className="label">増やす稼働数</div>
            <div className="note">{proj.current} → {proj.target} 名</div>
          </div></div>
        </div>
      </div>

      {/* ③ 離脱・メモ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, alignItems: "end", marginBottom: 12 }}>
        <Field label="許容離脱数（目標0）" unit="名" value={f.dropout_allowed} onChange={(v) => set({ dropout_allowed: v })} />
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="meta">メモ（任意）</span>
          <input type="text" value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="転換基準・補足など"
            style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 11 }}>
          {initial?.updated_at ? <>最終更新 {fmtDateTime(initial.updated_at)}{initial.updated_by_name ? ` ・ ${initial.updated_by_name}` : ""}</> : "未保存"}
        </span>
        <button type="button" className="btn brand" disabled={pending} onClick={save}>{pending ? "保存中…" : "KGIを保存"}</button>
      </div>
    </div>
  );
}

function Field({ label, unit, value, onChange, placeholder }:
  { label: string; unit: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="meta">{label}</span>
      <div style={{ position: "relative" }}>
        <input type="number" inputMode="decimal" step="any" min={0} value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "—"}
          style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 40px 8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--color-ink-4)" }}>{unit}</span>
      </div>
    </label>
  );
}
