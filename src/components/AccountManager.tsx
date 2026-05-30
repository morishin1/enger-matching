"use client";

import { useState, useTransition } from "react";
import { approveAccount, setAccountStatus, setAccountRole, setAccountPosition, setAccountFunctions, deleteAccount, createAgent, resetAccountPassword } from "@/app/settings/account-actions";
import type { Account, Role } from "@/lib/accounts";
import { FUNCTIONS } from "@/lib/roles";

const ROLE_LABEL: Record<Role, string> = { admin: "管理者", agent: "エージェント", client: "ユーザー企業", candidate: "人材", partner: "パートナー企業", freelance: "副業エージェント" };
const ROLE_TONE: Record<Role, { bg: string; fg: string }> = {
  admin: { bg: "#efe7fb", fg: "#6b21a8" },
  agent: { bg: "#eaf4fd", fg: "#0b5cab" },
  client: { bg: "#e7f7ee", fg: "#067647" },
  candidate: { bg: "#fff1e6", fg: "#b45309" },
  partner: { bg: "#eef2ff", fg: "#3730a3" },
  freelance: { bg: "#fef3f2", fg: "#b42318" },
};

function PendingRow({ a, busy, onApprove }: { a: Account; busy: boolean; onApprove: (fd: FormData) => void }) {
  const [role, setRole] = useState<Role>(a.role);
  const [company, setCompany] = useState(a.company_name ?? "");
  return (
    <form
      action={(fd) => { fd.set("id", a.id); fd.set("role", role); fd.set("company_name", company); onApprove(fd); }}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}
    >
      <div style={{ minWidth: 180, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name || "（名前未設定）"}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>{a.email}</div>
      </div>
      <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }}>
        <option value="client">ユーザー企業</option>
        <option value="agent">エージェント</option>
        <option value="admin">管理者</option>
      </select>
      <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="会社名（企業の場合）" style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5, width: 160 }} />
      <button type="submit" disabled={busy} style={{ padding: "7px 14px", borderRadius: 8, border: 0, background: "var(--color-brand-600, #0095D9)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>承認</button>
    </form>
  );
}

export function AccountManager({ accounts }: { accounts: Account[] }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [cred, setCred] = useState<{ email: string; password: string; note: string } | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => { const r = await fn(); setMsg(r.ok ? null : (r.error ?? "操作に失敗しました")); });

  // 仮パスワードを返す操作（作成・再発行）。成功時に1回だけ表示。
  const runCred = (fn: () => Promise<{ ok: boolean; error?: string; password?: string }>, email: string, note: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok && r.password) { setCred({ email, password: r.password, note }); setMsg(null); }
      else setMsg(r.error ?? "操作に失敗しました");
    });

  const waiting = accounts.filter((a) => a.status === "pending");
  const others = accounts.filter((a) => a.status !== "pending");

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>👤 アカウント・権限管理</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 11 }}>承認待ち {waiting.length} 件 / 全 {accounts.length} 件</span>
          <button type="button" onClick={() => setShowCreate((v) => !v)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-brand-600, #0095D9)", background: showCreate ? "var(--color-brand-50, #eaf4fd)" : "#fff", color: "var(--color-brand-700, #0b5cab)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{showCreate ? "× 閉じる" : "＋ エージェントを追加"}</button>
        </div>
      </div>

      {msg && <div style={{ fontSize: 12.5, color: "#b42318", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>{msg}</div>}

      {/* 仮パスワードの1回限り表示 */}
      {cred && (
        <div style={{ background: "#ecfdf3", border: "1px solid #abefc6", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#067647", marginBottom: 6 }}>✅ {cred.note}</div>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>本人に下記を伝えてください。<b>このパスワードは今だけ表示されます</b>（再表示不可・初回ログイン後に本人が変更）。</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>メール</span>
            <code style={{ fontSize: 13, background: "#fff", border: "1px solid #d1fadf", borderRadius: 6, padding: "5px 9px" }}>{cred.email}</code>
            <span style={{ fontSize: 12, color: "#64748b" }}>仮パスワード</span>
            <code style={{ fontSize: 13, fontWeight: 700, background: "#fff", border: "1px solid #d1fadf", borderRadius: 6, padding: "5px 9px", letterSpacing: ".02em" }}>{cred.password}</code>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(`${cred.email} / ${cred.password}`); }} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #abefc6", background: "#fff", fontSize: 11.5, fontWeight: 700, color: "#067647", cursor: "pointer" }}>コピー</button>
            <button type="button" onClick={() => setCred(null)} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--color-border)", background: "#fff", fontSize: 11.5, cursor: "pointer", color: "#6b7280", marginLeft: "auto" }}>閉じる</button>
          </div>
        </div>
      )}

      {/* 新規作成フォーム */}
      {showCreate && (
        <form
          action={(fd) => runCred(() => createAgent(fd), String(fd.get("email") ?? ""), "アカウントを作成しました")}
          style={{ background: "var(--color-brand-25, #f5fbff)", border: "1px solid var(--color-brand-100, #cfe9fb)", borderRadius: 10, padding: 14, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input name="name" placeholder="氏名" style={{ flex: 1, minWidth: 140, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }} />
            <input name="email" type="email" required placeholder="メールアドレス（ログインID）" style={{ flex: 2, minWidth: 200, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select name="role" defaultValue="agent" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }}>
              <option value="agent">エージェント</option>
              <option value="admin">管理者</option>
              <option value="client">ユーザー企業</option>
            </select>
            <select name="position" defaultValue="" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }}>
              <option value="">区分なし</option>
              <option value="inside">インサイド</option>
              <option value="outside">アウトサイド</option>
            </select>
            <input name="company_name" placeholder="会社名（企業の場合）" style={{ flex: 1, minWidth: 140, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }} />
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 10.5, marginRight: 2 }}>職能（兼務可）：</span>
            {FUNCTIONS.map((fn) => (
              <label key={fn} className="tag" style={{ cursor: "pointer", fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 4, background: "var(--color-surface-inset)", color: "var(--color-ink-3)" }}>
                <input type="checkbox" name="functions" value={fn} style={{ width: 13, height: 13 }} />{fn}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="submit" disabled={pending} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--color-brand-600, #0095D9)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>{pending ? "作成中…" : "作成して仮パスワードを発行"}</button>
            <span className="muted" style={{ fontSize: 11 }}>仮パスワードは自動生成され、作成後に1回だけ表示されます。</span>
          </div>
        </form>
      )}

      {accounts.length === 0 && (
        <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: 14, fontSize: 12.5 }}>
          アカウントテーブルが未作成、または登録がありません。SQL Editor で <span className="mono">supabase/accounts.sql</span> を実行し、初期管理者を登録してください。
        </div>
      )}

      {waiting.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>承認待ち</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {waiting.map((a) => (
              <PendingRow key={a.id} a={a} busy={pending} onApprove={(fd) => run(() => approveAccount(fd))} />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>登録済みアカウント</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {others.map((a) => {
              const t = ROLE_TONE[a.role];
              return (
                <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "9px 12px", border: "1px solid var(--color-border)", borderRadius: 10, opacity: a.status === "disabled" ? 0.55 : 1 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <div style={{ minWidth: 160, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name || "（名前未設定）"}{a.company_name ? <span className="muted" style={{ fontWeight: 400 }}>・{a.company_name}</span> : null}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{a.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.fg }}>{ROLE_LABEL[a.role]}</span>
                  <select value={a.role} onChange={(e) => run(() => setAccountRole(a.id, e.target.value as Role))} disabled={pending} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}>
                    <option value="client">ユーザー企業</option>
                    <option value="agent">エージェント</option>
                    <option value="admin">管理者</option>
                  </select>
                  {(a.role === "agent" || a.role === "admin") && (
                    <select value={a.position ?? ""} onChange={(e) => run(() => setAccountPosition(a.id, (e.target.value || null) as any))} disabled={pending} title="営業区分（管理者が決定）" style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}>
                      <option value="">区分なし</option>
                      <option value="inside">インサイド</option>
                      <option value="outside">アウトサイド</option>
                    </select>
                  )}
                  <button onClick={() => { if (confirm(`${a.email} のパスワードを再発行しますか？新しい仮パスワードが表示され、現在のパスワードは無効になります。`)) runCred(() => resetAccountPassword(a.email), a.email, "パスワードを再発行しました"); }} disabled={pending} title="パスワード再発行" style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#0b5cab" }}>🔑 PW再発行</button>
                  {a.status === "disabled" ? (
                    <button onClick={() => run(() => setAccountStatus(a.id, "active"))} disabled={pending} style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>有効化</button>
                  ) : (
                    <button onClick={() => run(() => setAccountStatus(a.id, "disabled"))} disabled={pending} style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#b42318" }}>無効化</button>
                  )}
                  <button onClick={() => { if (confirm(`${a.email} を削除しますか？`)) run(() => deleteAccount(a.id)); }} disabled={pending} title="削除" style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>×</button>
                  </div>
                  {(a.role === "agent" || a.role === "admin") && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 10.5, marginRight: 2 }}>職能（兼務可）：</span>
                      {FUNCTIONS.map((fn) => { const on = (a.functions ?? []).includes(fn); return (
                        <button key={fn} type="button" disabled={pending} onClick={() => run(() => setAccountFunctions(a.id, on ? (a.functions ?? []).filter((x) => x !== fn) : [...(a.functions ?? []), fn]))} className="tag" style={{ cursor: "pointer", fontSize: 10.5, border: 0, background: on ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)" }}>{fn}</button>
                      ); })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
