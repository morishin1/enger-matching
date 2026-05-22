"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStaff, updateStaff, deleteStaff } from "@/lib/actions";
import type { Staff } from "@/lib/staff";

export function StaffManager({ rows, fromTable }: { rows: Staff[]; fromTable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isP, setIsP] = useState(true);
  const [isC, setIsC] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<any>) => start(async () => { const r = await fn(); if (r && !r.ok) setMsg(r.error || "失敗しました"); else setMsg(null); router.refresh(); });

  const add = () => {
    if (!name.trim()) return;
    run(async () => { const r = await addStaff(name, isP, isC, email); if (r.ok) { setName(""); setEmail(""); } return r; });
  };

  if (!fromTable) {
    return (
      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
        <b>担当者マスタが未作成です。</b> SQL Editor で <span className="mono">supabase/staff.sql</span> を実行すると、提案者・クロージング担当を追加/削除できます。
      </div>
    );
  }

  const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" } as const;

  return (
    <div className="card flush">
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div><h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>担当者マスタ</h3><div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>提案管理の「提案者 / クロージング担当」の選択肢になります</div></div>
      </div>

      {/* 追加フォーム */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
        <input style={{ ...inp, flex: "1 1 140px" }} placeholder="氏名" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <input style={{ ...inp, flex: "1 1 200px" }} type="email" placeholder="ログイン用メール(任意)" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={isP} onChange={(e) => setIsP(e.target.checked)} />提案者</label>
        <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12.5 }}><input type="checkbox" checked={isC} onChange={(e) => setIsC(e.target.checked)} />クロージング</label>
        <button type="button" className="btn brand btn-xs" disabled={pending || !name.trim()} onClick={add}>追加</button>
      </div>

      <table className="tbl">
        <thead><tr><th>氏名</th><th>ログイン用メール</th><th style={{ width: 130 }}>区分</th><th style={{ width: 90 }}>提案者</th><th style={{ width: 110 }}>クロージング</th><th style={{ width: 80 }}>削除</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)" }}>担当者がいません。上のフォームから追加してください。</td></tr>
          ) : rows.map((s) => (
            <tr key={s.id}>
              <td style={{ fontWeight: 600 }}>{s.name}</td>
              <td><input type="email" defaultValue={s.email ?? ""} placeholder="未設定" disabled={pending} style={{ ...inp, fontSize: 12, padding: "5px 8px", width: "100%" }} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (s.email ?? "")) run(() => updateStaff(s.id, { email: v })); }} /></td>
              <td>
                <select value={s.position ?? ""} disabled={pending} style={{ ...inp, fontSize: 12, padding: "5px 8px", width: "100%" }}
                  onChange={(e) => run(() => updateStaff(s.id, { position: e.target.value || null }))}>
                  <option value="">未設定</option>
                  <option value="inside">インサイド</option>
                  <option value="outside">アウトサイド</option>
                </select>
              </td>
              <td><input type="checkbox" checked={s.is_proposer} disabled={pending} onChange={(e) => run(() => updateStaff(s.id, { is_proposer: e.target.checked }))} /></td>
              <td><input type="checkbox" checked={s.is_closer} disabled={pending} onChange={(e) => run(() => updateStaff(s.id, { is_closer: e.target.checked }))} /></td>
              <td><button type="button" className="btn ghost btn-xs" style={{ color: "var(--color-danger)" }} disabled={pending} onClick={() => { if (confirm(`「${s.name}」を削除しますか？`)) run(() => deleteStaff(s.id)); }}>削除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "10px 18px", fontSize: 11, color: "var(--color-ink-4)", lineHeight: 1.7 }}>
        ※ ログイン用メールを設定すると、そのメールのアカウントだけ dx にログインできます（許可リスト）。<br />
        実際のログインアカウント（パスワード）は Supabase の Authentication → Users で発行してください。
      </div>
      {msg && <div style={{ padding: "10px 18px", color: "var(--color-danger)", fontSize: 12.5 }}>{msg}</div>}
    </div>
  );
}
