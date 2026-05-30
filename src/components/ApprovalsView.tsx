"use client";

// 新規登録（承認）画面。企業 / 人材 / 営業 / 管理者 をタブで切り分け、
// 承認待ちを承認すると、その区分のダッシュボード/ポータルを利用できるようになる。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account, Role } from "@/lib/accounts";
import { approveAccount, setAccountStatus, setAccountRole, setAccountMeetingDone } from "@/app/settings/account-actions";

type TabKey = "client" | "partner" | "freelance" | "candidate" | "agent" | "admin";
const TABS: { key: TabKey; label: string; role: Role; hint: string }[] = [
  { key: "client", label: "企業", role: "client", hint: "承認すると自社ポータル（案件掲載・おすすめ人材・選考）を利用できます。" },
  { key: "partner", label: "パートナー企業", role: "partner", hint: "承認すると、自社＋共有の案件/人材でマッチングできます。他社情報は匿名表示で漏洩防止。" },
  { key: "freelance", label: "副業エージェント", role: "freelance", hint: "ag.enger.jp から登録した個人。自分＋共有でマッチング。他社は匿名表示で漏洩防止。" },
  { key: "candidate", label: "人材", role: "candidate", hint: "承認すると人材ダッシュボードを利用できます。" },
  { key: "agent", label: "営業", role: "agent", hint: "承認すると営業業務（マッチング・提案等）を利用できます。" },
  { key: "admin", label: "管理者", role: "admin", hint: "全機能にアクセスできます。" },
];

const STATUS_BADGE: Record<string, { l: string; c: string; bg: string }> = {
  pending: { l: "承認待ち", c: "#b45309", bg: "#fff6e0" },
  active: { l: "有効", c: "#067647", bg: "#e7f7ee" },
  disabled: { l: "無効", c: "#b42318", bg: "#fdecef" },
};

const fmtDate = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };

export function ApprovalsView({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("client");
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pendingCount = useMemo(() => {
    const m: Record<TabKey, number> = { client: 0, partner: 0, freelance: 0, candidate: 0, agent: 0, admin: 0 };
    for (const a of accounts) if (a.status === "pending") m[a.role as TabKey] = (m[a.role as TabKey] ?? 0) + 1;
    return m;
  }, [accounts]);

  const cur = TABS.find((t) => t.key === tab)!;
  const rows = accounts.filter((a) => a.role === cur.role)
    .sort((a, b) => (a.status === "pending" ? -1 : 1) - (b.status === "pending" ? -1 : 1) || String(b.created_at).localeCompare(String(a.created_at)));

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
    run(a.id, () => approveAccount(fd), `${a.name || a.email} を承認しました`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* タブ */}
      <div role="tablist" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const pc = pendingCount[t.key] ?? 0;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              style={{ padding: "10px 18px", background: "transparent", border: 0, borderBottom: active ? "2px solid var(--color-brand-600)" : "2px solid transparent", color: active ? "var(--color-brand-700)" : "var(--color-ink-3)", fontWeight: active ? 700 : 600, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span>{t.label}</span>
              {pc > 0 && <span className="badge hot" style={{ fontSize: 10, padding: "1px 7px" }}>{pc}</span>}
            </button>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{cur.hint}</div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}

      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30, fontSize: 13 }}>{cur.label}の登録はまだありません。</div>
      ) : (
        <div className="card flush">
          <div className="tbl-scroll" style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 720 }}>
              <thead>
                <tr><th>状態</th><th>名前 / 会社</th><th>メール</th><th>申請日</th><th style={{ width: 240 }}>操作</th></tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
                  const busy = busyId === a.id && pending;
                  return (
                    <tr key={a.id}>
                      <td><span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, color: sb.c, background: sb.bg }}>{sb.l}</span></td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name || "（名前未設定）"}</div>
                        {a.company_name && <div className="muted" style={{ fontSize: 11 }}>{a.company_name}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{a.email}</td>
                      <td style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{fmtDate(a.created_at)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          {a.status === "pending" && (
                            <button type="button" className="btn brand btn-xs" disabled={busy} onClick={() => doApprove(a)}>{busy ? "処理中…" : "✓ 承認"}</button>
                          )}
                          {a.status === "active" && (
                            <button type="button" className="btn ghost btn-xs" disabled={busy} style={{ color: "var(--color-danger)" }} onClick={() => run(a.id, () => setAccountStatus(a.id, "disabled"), "無効化しました")}>無効化</button>
                          )}
                          {a.status === "disabled" && (
                            <button type="button" className="btn ghost btn-xs" disabled={busy} onClick={() => run(a.id, () => setAccountStatus(a.id, "active"), "再有効化しました")}>再有効化</button>
                          )}
                          {/* 面談済みフラグ：partner/freelance/candidate の詳細解放を制御 */}
                          {a.status === "active" && (a.role === "partner" || a.role === "freelance" || a.role === "candidate") && (
                            (a as any).meeting_done
                              ? <button type="button" className="btn ghost btn-xs" disabled={busy} title="面談済みを取り消し（詳細を再制限）" onClick={() => run(a.id, () => setAccountMeetingDone(a.id, false), "面談済みを取り消しました")}>✓ 面談済み</button>
                              : <button type="button" className="btn btn-xs" disabled={busy} style={{ background: "#067647", borderColor: "#067647", color: "#fff" }} onClick={() => run(a.id, () => setAccountMeetingDone(a.id, true), "面談済みにしました（詳細解放）")}>面談済みにする</button>
                          )}
                          {/* 区分の付け替え（誤って別区分で登録された場合の救済） */}
                          <select defaultValue={a.role} disabled={busy}
                            onChange={(e) => { const r = e.target.value as Role; run(a.id, () => setAccountRole(a.id, r as any), "区分を変更しました"); }}
                            style={{ fontFamily: "inherit", fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
                            <option value="client">企業</option>
                            <option value="partner">パートナー企業</option>
                            <option value="freelance">副業エージェント</option>
                            <option value="candidate">人材</option>
                            <option value="agent">営業</option>
                            <option value="admin">管理者</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
