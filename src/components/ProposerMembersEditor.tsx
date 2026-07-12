"use client";

// #338：KGI「チーム目標」内に置く「メンバー編集（名前のみ）」。
//   KPI推移の「メンバー別アクティビティ→メンバー編集」と同じ proposal_owners（提案者/クロージング担当）を
//   編集する。メールアドレス不要で氏名だけで登録でき、ここで登録した提案者は
//   下の「メンバー別KPI」にそのまま表示・保存できる（合成キーで person_kgi に保存）。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProposalOwners } from "@/app/settings/permission-actions";

export function ProposerMembersEditor({ initial, suggestions }: {
  initial: { proposers: string[]; closers: string[] };
  suggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <button type="button" className="btn ghost btn-sm" onClick={() => setOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, lineHeight: 1 }}>group_add</span>
        メンバー追加・削除・編集（氏名のみ・メール不要）
      </button>
      <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
        ここで登録した<b>提案者</b>は、下の「メンバー別KPI」にそのまま表示されます（メールアドレス不要）。
      </div>
      {open && <MembersModal initial={initial} suggestions={suggestions} onClose={() => setOpen(false)} />}
    </div>
  );
}

function MembersModal({ initial, suggestions, onClose }: {
  initial: { proposers: string[]; closers: string[] };
  suggestions: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [proposers, setProposers] = useState<string[]>(initial.proposers ?? []);
  const [closers, setClosers] = useState<string[]>(initial.closers ?? []);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const save = () => {
    start(async () => {
      const r = await saveProposalOwners({ proposers, closers });
      if (!r.ok) { setMsg(`保存失敗: ${r.error}`); return; }
      setMsg("✓ 保存しました");
      router.refresh();
      setTimeout(() => onClose(), 600);
    });
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "min(720px, 94vw)", padding: 18, maxHeight: "90vh", overflow: "auto" }}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>メンバー編集（表示する人の増減）</h3>
        <div className="muted" style={{ fontSize: 12 }}>提案者・クロージング担当の名前リストを編集します。メールアドレスは不要です。提案者は「メンバー別KPI」に表示されます。</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <NameList label="提案者" tone="brand" items={proposers} suggestions={suggestions} onChange={setProposers} />
          <NameList label="クロージング担当" tone="accent" items={closers} suggestions={suggestions} onChange={setClosers} />
        </div>
        {msg && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button type="button" className="btn" onClick={onClose} disabled={pending}>キャンセル</button>
          <button type="button" className="btn brand" onClick={save} disabled={pending}>保存</button>
        </div>
      </div>
    </div>
  );
}

function NameList({ label, tone, items, suggestions, onChange }: { label: string; tone: "brand" | "accent"; items: string[]; suggestions: string[]; onChange: (xs: string[]) => void }) {
  const [input, setInput] = useState("");
  const color = tone === "accent" ? "#067647" : "var(--color-brand-700)";
  const bg = tone === "accent" ? "#e7f7ee" : "var(--color-brand-25)";
  const bd = tone === "accent" ? "#bfe3cc" : "var(--color-brand-100)";
  const add = (v: string) => { const n = (v ?? "").trim(); if (!n || items.includes(n)) return; onChange([...items, n]); setInput(""); };
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  return (
    <div style={{ border: `1px solid ${bd}`, background: bg, borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 6 }}>{label}（{items.length}名）</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {items.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>未設定</div>}
        {items.map((name, i) => (
          <div key={name + i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 7, background: "#fff", border: "1px solid var(--color-border)" }}>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{name}</span>
            <button type="button" onClick={() => remove(i)} title="削除"
              style={{ padding: "2px 8px", fontSize: 12, fontWeight: 800, color: "#b42318", background: "transparent", border: 0, cursor: "pointer", borderRadius: 6 }}>✕</button>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); add(input); }} style={{ display: "flex", gap: 6 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="氏名を入力" maxLength={30}
          style={{ flex: 1, fontSize: 12.5, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "#fff" }} />
        <button type="submit" className="btn brand btn-xs" disabled={!input.trim()}>＋追加</button>
      </form>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {Array.from(new Set(suggestions)).filter((s) => !items.includes(s)).slice(0, 8).map((s) => (
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
