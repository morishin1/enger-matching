"use client";

// 「新着」タブの一覧（企業管理＝エンジャービジネス経由の企業、マッチング＝エンジャーフリーランス経由の人材）。
//   ユーザー管理（設定）から企業・人材の承認導線を移設したもの。
//   ・app_users の承認待ち（client/partner または candidate/freelance）
//   ・LP 仮想行（profiles / auth.users にだけ居る登録。id が profile:/auth: で始まる）
//   をまとめて表示し、その場で承認・削除できる。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/accounts";
import { approveAccount, deleteAccount, bulkDeleteAccounts } from "@/app/settings/account-actions";

const isLpVirtual = (id: string) => id.startsWith("profile:") || id.startsWith("auth:");

// LP由来（profile:/auth: の仮想行）の登録元ラベル。
const LP_ORIGIN: Record<string, { label: string; color: string }> = {
  dojo:  { label: "LP登録（無限道場）", color: "#d97706" },
  enger: { label: "LP登録（enger.jp）", color: "#0095D9" },
};
function originLabel(a: Account): { label: string; color: string } | null {
  if (!isLpVirtual(a.id)) return null;
  if (a.role === "client" || a.role === "partner") return { label: "エンジャービジネス登録", color: "#0b5cab" };
  const ss = (a as any).signup_source as string | null | undefined;
  return ss && LP_ORIGIN[ss] ? LP_ORIGIN[ss] : { label: "LP登録", color: "#94a3b8" };
}

const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function NewRegistrationsList({ rows, kind }: { rows: Account[]; kind: "company" | "talent" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const noun = kind === "company" ? "企業" : "人材";
  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setBusyId(id); setMsg(null);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.ok) { setMsg({ ok: true, text: okText }); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "操作に失敗しました" });
    });
  };
  const doApprove = (a: Account) => {
    const fd = new FormData();
    fd.set("id", a.id);
    fd.set("role", a.role);
    if (a.company_name) fd.set("company_name", a.company_name);
    if (isLpVirtual(a.id)) { fd.set("email", a.email); if (a.name) fd.set("name", a.name); }
    run(a.id, () => approveAccount(fd), `${a.name || a.email} を承認しました`);
  };
  const doDelete = (a: Account) => {
    if (!confirm(`${a.email} の登録を削除しますか？この操作は取り消せません。`)) return;
    run(a.id, () => (isLpVirtual(a.id)
      ? bulkDeleteAccounts([{ id: a.id, email: a.email ?? null }]).then((r) => ({ ok: r.ok && (r.deleted ?? 0) > 0, error: r.ok ? r.errors?.[0]?.error : r.error }))
      : deleteAccount(a.id)), "削除しました");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {kind === "company"
          ? <>エンジャービジネス（enger.jp 法人登録）から届いた<b>企業の新規登録</b>です。承認すると自社ポータル（案件掲載・おすすめ人材・選考）を利用できるようになります。</>
          : <>エンジャーフリーランス（enger.jp）から届いた<b>人材の新規登録</b>です。承認すると人材ダッシュボードを利用でき、フリーランス一覧・マッチング対象に反映されます。</>}
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}
      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30, fontSize: 13 }}>
          未対応の新着{noun}はありません。
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((a) => {
              const busy = busyId === a.id && pending;
              const origin = originLabel(a);
              return (
                <div key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10,
                    background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 99, color: "#b45309", background: "#fff6e0", flexShrink: 0 }}>承認待ち</span>
                  <b style={{ fontSize: 12.5 }}>{a.name || "（名前未設定）"}</b>
                  <span className="muted mono" style={{ fontSize: 11 }}>{a.email}</span>
                  {a.company_name && <span className="muted" style={{ fontSize: 11 }}>{a.company_name}</span>}
                  {origin && <span style={{ fontSize: 9.5, fontWeight: 700, color: origin.color, flexShrink: 0 }}>{origin.label}</span>}
                  <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }} title={a.created_at}>{fmtDateTime(a.created_at)}</span>
                  <button type="button" className="btn btn-xs" disabled={busy} onClick={() => doApprove(a)} title={`${noun}として承認します`}
                    style={{ background: "#067647", borderColor: "#067647", color: "#fff", flexShrink: 0 }}>
                    {busy ? "処理中…" : "承認"}
                  </button>
                  <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => doDelete(a)} title="登録を削除（スパム等）"
                    style={{ color: "var(--color-danger)", flexShrink: 0 }}>削除</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
