"use client";

// 提案者・クロージング担当の名前リストを編集する管理者向けUI。
//   ・自由入力＋追加ボタン
//   ・✕ボタンで削除、順序変更は↑↓
//   ・保存で app_settings(key='proposal_owners') に保存
//   ・空のままだとフォールバック（accounts のメンバー一覧）が使われる

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProposalOwners } from "@/app/settings/permission-actions";
import type { ProposalOwners } from "@/lib/proposal-owners";

export function ProposalOwnersEditor({ initial, suggestions = [] }: { initial: ProposalOwners; suggestions?: string[] }) {
  const router = useRouter();
  const [proposers, setProposers] = useState<string[]>(initial.proposers ?? []);
  const [closers, setClosers] = useState<string[]>(initial.closers ?? []);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const save = () => {
    setMsg(null);
    start(async () => {
      const r = await saveProposalOwners({ proposers, closers });
      if (r.ok) { setMsg({ ok: true, text: "保存しました（提案管理・マッチングに反映されます）" }); setDirty(false); router.refresh(); }
      else setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
    });
  };

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>👥 提案者・クロージング担当（選択肢の編集）</h3>
        <span className="muted" style={{ fontSize: 11 }}>提案詳細／メール作成の選択肢に反映</span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 12, lineHeight: 1.7 }}>
        ここで設定した名前が、提案ボード／詳細モーダル／メール送信時の <b>提案者</b>・<b>クロージング</b> 選択肢になります。
        空のままだと、アカウント管理の登録メンバー全員が候補になります。
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <NameList label="提案者" tone="brand" items={proposers} suggestions={suggestions}
          onChange={(xs) => { setProposers(xs); setDirty(true); }} />
        <NameList label="クロージング担当" tone="accent" items={closers} suggestions={suggestions}
          onChange={(xs) => { setClosers(xs); setDirty(true); }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <button type="button" className="btn brand" disabled={pending || !dirty} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
        {dirty && <span className="muted" style={{ fontSize: 11.5, color: "#b45309" }}>未保存の変更があります</span>}
        {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.text}</span>}
      </div>
    </div>
  );
}

function NameList({ label, tone, items, suggestions, onChange }: { label: string; tone: "brand" | "accent"; items: string[]; suggestions: string[]; onChange: (xs: string[]) => void }) {
  const [input, setInput] = useState("");
  const color = tone === "accent" ? "#067647" : "var(--color-brand-700)";
  const bg = tone === "accent" ? "#e7f7ee" : "var(--color-brand-25)";
  const bd = tone === "accent" ? "#bfe3cc" : "var(--color-brand-100)";

  const add = (v: string) => {
    const n = (v ?? "").trim();
    if (!n) return;
    if (items.includes(n)) return;
    onChange([...items, n]);
    setInput("");
  };
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div style={{ border: `1px solid ${bd}`, background: bg, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color, marginBottom: 8 }}>{label}（{items.length} 名）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {items.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>未設定（アカウントの登録メンバー全員が候補になります）</div>}
        {items.map((name, i) => (
          <div key={name + i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 7, background: "#fff", border: "1px solid var(--color-border)" }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{name}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
              title="上へ" className="btn ghost btn-xs" style={{ padding: "2px 6px", fontSize: 11 }}>↑</button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1}
              title="下へ" className="btn ghost btn-xs" style={{ padding: "2px 6px", fontSize: 11 }}>↓</button>
            <button type="button" onClick={() => remove(i)} title="削除"
              style={{ padding: "2px 8px", fontSize: 12, fontWeight: 800, color: "#b42318", background: "transparent", border: 0, cursor: "pointer", borderRadius: 6 }}>✕</button>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); add(input); }} style={{ display: "flex", gap: 6 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="氏名を入力して追加" maxLength={30}
          style={{ flex: 1, fontFamily: "inherit", fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "#fff" }} />
        <button type="submit" className="btn brand btn-xs" disabled={!input.trim()}>＋ 追加</button>
      </form>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {suggestions.filter((s) => !items.includes(s)).slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 99, border: "1px dashed var(--color-border-strong)", background: "transparent", cursor: "pointer", color: "var(--color-ink-3)", fontFamily: "inherit" }}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
