"use client";

// 新規登録（承認）画面。企業 / 人材 / 営業 / 管理者 をタブで切り分け、
// 承認待ちを承認すると、その区分のダッシュボード/ポータルを利用できるようになる。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account, Role } from "@/lib/accounts";
import { approveAccount, setAccountStatus, setAccountRole, setAccountMeetingDone, setAccountOwnerAgent, setAccountNote, getAccountActivity } from "@/app/settings/account-actions";
import { ApprovalDetailPanel } from "./ApprovalDetailPanel";

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
const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function ApprovalsView({ accounts, agents = [] }: { accounts: Account[]; agents?: { email: string | null; name: string | null }[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("client");
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 詳細(メール送信＋面談)パネルの展開状態と取得済みアクティビティ
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, { emails: any[]; meetings: any[] }>>({});
  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!activity[id]) {
      const res = await getAccountActivity(id);
      if (res.ok) setActivity((m) => ({ ...m, [id]: { emails: res.emails, meetings: res.meetings } }));
    }
  };

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
    // LP仮想エントリ（profile:）の場合は app_users 作成のため email/name も送る
    if (a.id.startsWith("profile:")) { fd.set("email", a.email); if (a.name) fd.set("name", a.name); }
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
                <tr><th>状態</th><th>名前 / 会社</th><th>メール</th><th>申請日時</th><th style={{ width: 140 }}>担当エージェント</th><th style={{ width: 200 }}>メモ（根拠/連絡）</th><th style={{ width: 220 }}>承認・面談履歴</th><th style={{ width: 260 }}>操作</th></tr>
              </thead>
              <tbody>
                {rows.flatMap((a) => {
                  const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
                  const busy = busyId === a.id && pending;
                  const mainRow = (
                    <tr key={a.id}>
                      <td><span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, color: sb.c, background: sb.bg }}>{sb.l}</span></td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name || "（名前未設定）"}</div>
                        {a.company_name && <div className="muted" style={{ fontSize: 11 }}>{a.company_name}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{a.email}</td>
                      <td style={{ fontSize: 11.5, color: "var(--color-ink-3)" }} title={a.created_at}>
                        {fmtDateTime(a.created_at)}
                        {a.id.startsWith("profile:") && <div style={{ fontSize: 9.5, color: "#0095D9", fontWeight: 700, marginTop: 2 }}>LP登録（enger.jp）</div>}
                      </td>
                      <td>
                        <select disabled={busy || a.id.startsWith("profile:")} defaultValue={(a as any).owner_agent_email ?? ""}
                          onChange={(e) => {
                            const em = e.target.value || null;
                            const ag = agents.find((x) => x.email === em);
                            run(a.id, () => setAccountOwnerAgent(a.id, em, ag?.name ?? null), em ? `担当を ${ag?.name || em} に設定` : "担当をクリア");
                          }}
                          style={{ fontFamily: "inherit", fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", maxWidth: 130 }}>
                          <option value="">— 未割当 —</option>
                          {agents.map((ag) => (
                            <option key={ag.email ?? ag.name ?? ""} value={ag.email ?? ""}>{ag.name ?? ag.email}</option>
                          ))}
                        </select>
                        {(a as any).owner_agent_name && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{(a as any).owner_agent_name}</div>}
                      </td>
                      <td>
                        <input type="text" defaultValue={(a as any).note ?? ""} disabled={busy || a.id.startsWith("profile:")}
                          placeholder="連絡・面談メモ"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            const cur = ((a as any).note ?? "") as string;
                            if (v !== cur) run(a.id, () => setAccountNote(a.id, v), "メモを保存しました");
                          }}
                          style={{ fontFamily: "inherit", fontSize: 11, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", width: "100%" }} />
                      </td>
                      <td style={{ fontSize: 11, color: "var(--color-ink-3)", lineHeight: 1.6 }}>
                        {a.approved_at ? (
                          <div>承認 {fmtDate(a.approved_at)}<br /><span className="muted">by {a.approved_by_name || a.approved_by_email || "—"}</span></div>
                        ) : <span className="muted">未承認</span>}
                        {(a as any).meeting_done && (a as any).meeting_done_at && (
                          <div style={{ marginTop: 4, color: "#067647" }}>面談済 {fmtDate((a as any).meeting_done_at)}<br /><span className="muted">by {(a as any).meeting_done_by_name || (a as any).meeting_done_by_email || "—"}</span></div>
                        )}
                      </td>
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
                          {/* 面談済みフラグ：外部ロール（企業/パートナー/副業/人材）の詳細解放を制御 */}
                          {a.status === "active" && (a.role === "client" || a.role === "partner" || a.role === "freelance" || a.role === "candidate") && (
                            (a as any).meeting_done
                              ? <button type="button" className="btn ghost btn-xs" disabled={busy} title="面談済みを取り消し（詳細を再制限）" onClick={() => run(a.id, () => setAccountMeetingDone(a.id, false), "面談済みを取り消しました")}>✓ 面談済み</button>
                              : <button type="button" className="btn btn-xs" disabled={busy} style={{ background: "#067647", borderColor: "#067647", color: "#fff" }} onClick={() => run(a.id, () => setAccountMeetingDone(a.id, true), "面談済みにしました（詳細解放）")}>面談済みにする</button>
                          )}
                          {/* 区分の付け替え（誤って別区分で登録された場合の救済） */}
                          <select defaultValue={a.role} disabled={busy || a.id.startsWith("profile:")}
                            onChange={(e) => { const r = e.target.value as Role; run(a.id, () => setAccountRole(a.id, r as any), "区分を変更しました"); }}
                            style={{ fontFamily: "inherit", fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
                            <option value="client">企業</option>
                            <option value="partner">パートナー企業</option>
                            <option value="freelance">副業エージェント</option>
                            <option value="candidate">人材</option>
                            <option value="agent">営業</option>
                            <option value="admin">管理者</option>
                          </select>
                          {/* メール送信＋面談予定（展開）。LP仮想行は承認後に有効化（履歴はDB id 必須） */}
                          {!a.id.startsWith("profile:") && (
                            <button type="button" className="btn ghost btn-xs" onClick={() => toggleExpand(a.id)} title="メール送信／面談予定を開く">
                              {expanded === a.id ? "閉じる" : "📧 連絡・面談"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  const expandedRow = expanded === a.id ? (
                    <tr key={`${a.id}-x`}>
                      <td colSpan={8} style={{ background: "var(--color-surface-soft)", padding: 12 }}>
                        <ApprovalDetailPanel account={a} emails={activity[a.id]?.emails ?? []} meetings={activity[a.id]?.meetings ?? []} />
                      </td>
                    </tr>
                  ) : null;
                  return expandedRow ? [mainRow, expandedRow] : [mainRow];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
