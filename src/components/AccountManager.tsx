"use client";

import { useState, useTransition } from "react";
import { approveAccount, setAccountStatus, setAccountRole, setAccountPosition, deleteAccount } from "@/app/settings/account-actions";
import type { Account, Role } from "@/lib/accounts";

const ROLE_LABEL: Record<Role, string> = { admin: "管理者", agent: "営業", client: "ユーザー企業" };
const ROLE_TONE: Record<Role, { bg: string; fg: string }> = {
  admin: { bg: "#efe7fb", fg: "#6b21a8" },
  agent: { bg: "#eaf4fd", fg: "#0b5cab" },
  client: { bg: "#e7f7ee", fg: "#067647" },
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
        <option value="agent">営業</option>
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

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => { const r = await fn(); setMsg(r.ok ? null : (r.error ?? "操作に失敗しました")); });

  const waiting = accounts.filter((a) => a.status === "pending");
  const others = accounts.filter((a) => a.status !== "pending");

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>👤 アカウント・権限管理</h3>
        <span className="muted" style={{ fontSize: 11 }}>承認待ち {waiting.length} 件 / 全 {accounts.length} 件</span>
      </div>

      {msg && <div style={{ fontSize: 12.5, color: "#b42318", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 11px", marginBottom: 10 }}>{msg}</div>}

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
                <div key={a.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "9px 12px", border: "1px solid var(--color-border)", borderRadius: 10, opacity: a.status === "disabled" ? 0.55 : 1 }}>
                  <div style={{ minWidth: 160, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name || "（名前未設定）"}{a.company_name ? <span className="muted" style={{ fontWeight: 400 }}>・{a.company_name}</span> : null}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{a.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: t.bg, color: t.fg }}>{ROLE_LABEL[a.role]}</span>
                  <select value={a.role} onChange={(e) => run(() => setAccountRole(a.id, e.target.value as Role))} disabled={pending} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}>
                    <option value="client">ユーザー企業</option>
                    <option value="agent">営業</option>
                    <option value="admin">管理者</option>
                  </select>
                  {(a.role === "agent" || a.role === "admin") && (
                    <select value={a.position ?? ""} onChange={(e) => run(() => setAccountPosition(a.id, (e.target.value || null) as any))} disabled={pending} title="営業区分（管理者が決定）" style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}>
                      <option value="">区分なし</option>
                      <option value="inside">インサイド</option>
                      <option value="outside">アウトサイド</option>
                    </select>
                  )}
                  {a.status === "disabled" ? (
                    <button onClick={() => run(() => setAccountStatus(a.id, "active"))} disabled={pending} style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>有効化</button>
                  ) : (
                    <button onClick={() => run(() => setAccountStatus(a.id, "disabled"))} disabled={pending} style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#b42318" }}>無効化</button>
                  )}
                  <button onClick={() => { if (confirm(`${a.email} を削除しますか？`)) run(() => deleteAccount(a.id)); }} disabled={pending} title="削除" style={{ padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, cursor: "pointer", color: "#6b7280" }}>×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
