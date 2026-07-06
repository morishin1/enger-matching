"use client";

// 個人KGI「メンバー追加・削除・編集」メニュー（#313）。
//   ・チーム目標（部署全体）の表に置き、この部署の「メンバー別KPI」に出す担当者を管理する。
//   ・追加はアカウント（既存の社内ユーザー）から選ぶ／氏名＋メールで手入力も可。
//     ※ person_kgi は owner_email をキーに保存するため、メンバーには実在アカウントの email が必要。
//   ・保存すると app_settings(person_kgi_members) に保存され、メンバー別KPIの対象に反映される。
//   ・未設定（名簿なし）の間はアカウントの部署設定から自動表示。保存するとこの一覧で固定される。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePersonKgiMembers } from "@/lib/person-kgi-members-actions";
import type { PersonKgiMember } from "@/lib/person-kgi-members";

export function PersonKgiMembersEditor({ department, initial, suggestions = [], usingAuto }: {
  department: string;
  initial: PersonKgiMember[];
  suggestions?: PersonKgiMember[]; // 追加候補（既存アカウント：email+氏名）
  usingAuto: boolean;              // true=名簿未設定でアカウントから自動表示中
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<PersonKgiMember[]>(initial ?? []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const setAll = (xs: PersonKgiMember[]) => { setMembers(xs); setDirty(true); setMsg(null); };
  const has = (em: string) => members.some((m) => m.email === em.trim().toLowerCase());
  const add = (nm: string, em: string) => {
    const name = (nm ?? "").trim();
    const mail = (em ?? "").trim().toLowerCase();
    if (!name || !mail) return;
    if (has(mail)) return;
    setAll([...members, { email: mail, name }]);
    setName(""); setEmail("");
  };
  const remove = (i: number) => setAll(members.filter((_, j) => j !== i));
  const setMemberName = (i: number, nm: string) => setAll(members.map((m, j) => (j === i ? { ...m, name: nm } : m)));

  const remaining = useMemo(
    () => suggestions.filter((s) => !members.some((m) => m.email === s.email)),
    [suggestions, members],
  );

  const save = () => {
    setMsg(null);
    start(async () => {
      const r = await savePersonKgiMembers(department, members);
      if (r.ok) { setMsg({ ok: true, text: "保存しました（メンバー別KPIに反映されます）" }); setDirty(false); router.refresh(); }
      else setMsg({ ok: false, text: r.error ?? "保存に失敗しました" });
    });
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, marginBottom: 12, background: "var(--color-surface-inset)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "transparent", border: 0, cursor: "pointer", padding: "10px 12px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-2)" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "var(--color-brand-700)" }}>group</span>
        メンバー追加・削除・編集（{members.length}名）
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
          {usingAuto ? "現在はアカウント（部署所属）から自動表示中。ここで編集・保存するとこの一覧が対象になります。" : "この一覧が「メンバー別KPI」の対象です。"}
        </span>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, marginLeft: "auto" }}>{open ? "expand_less" : "expand_more"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {members.length === 0 && <div className="muted" style={{ fontSize: 11.5 }}>メンバー未登録です。下の候補か入力欄から追加してください。</div>}
            {members.map((m, i) => (
              <div key={m.email + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                <input value={m.name} onChange={(e) => setMemberName(i, e.target.value)} placeholder="氏名" maxLength={40}
                  style={{ flex: "1 1 120px", minWidth: 0, fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)" }} />
                <span className="mono muted" style={{ flex: "1 1 160px", minWidth: 0, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.email}>{m.email}</span>
                <button type="button" onClick={() => remove(i)} title="削除"
                  style={{ padding: "2px 8px", fontSize: 12, fontWeight: 800, color: "#b42318", background: "transparent", border: 0, cursor: "pointer", borderRadius: 6, flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>

          {/* 既存アカウントから追加 */}
          {remaining.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 10.5 }}>アカウントから追加:</span>
              {remaining.slice(0, 20).map((s) => (
                <button key={s.email} type="button" onClick={() => add(s.name, s.email)} title={s.email}
                  style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 99, border: "1px dashed var(--color-border-strong)", background: "transparent", cursor: "pointer", color: "var(--color-ink-3)", fontFamily: "inherit" }}>
                  + {s.name}
                </button>
              ))}
            </div>
          )}

          {/* 氏名＋メールで手入力追加（既存アカウントのメール） */}
          <form onSubmit={(e) => { e.preventDefault(); add(name, email); }} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="氏名" maxLength={40}
              style={{ flex: "1 1 120px", minWidth: 0, fontFamily: "inherit", fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メール（アカウントのメール）" maxLength={120} inputMode="email"
              style={{ flex: "2 1 200px", minWidth: 0, fontFamily: "inherit", fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
            <button type="submit" className="btn brand btn-xs" disabled={!name.trim() || !email.trim()}>＋ 追加</button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="btn brand btn-sm" disabled={pending || !dirty} onClick={save}>{pending ? "保存中…" : "保存する"}</button>
            {dirty && <span className="muted" style={{ fontSize: 11.5, color: "#b45309" }}>未保存の変更があります</span>}
            {msg && <span style={{ fontSize: 12, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.ok ? "✓ " : "⚠ "}{msg.text}</span>}
          </div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            ※ メンバー別KPIは owner_email をキーに保存します。メンバーには実在アカウントのメールを設定してください
            （管理者は全アカウント、マネージャー/リーダーは自部署のアカウントが対象）。
          </div>
        </div>
      )}
    </div>
  );
}
