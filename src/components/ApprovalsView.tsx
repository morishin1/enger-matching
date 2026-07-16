"use client";

// ユーザー管理（マッチングを行うエージェント専用）。
//   ・一覧に表示するのは社内のエージェント（admin / agent）だけ。
//     企業・フリーランスの新規登録は「企業管理 → 新着」「マッチング → 新着」タブで承認する。
//   ・権限は「メンバー / マネージャー / 管理」の3段階のみ（バックオフィス等の区分は廃止）。
//   ・行はマウスホバーでハイライトし、クリックで右のドロワーが開く（「詳細」ボタンは廃止）。
//   ・ドロワーは 承認/無効化・権限・メモ・PW再発行・削除 だけのシンプル構成。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/lib/accounts";
import { approveAccount, bulkDeleteAccounts, setAccountStatus, setAccountNote, createAgent, resetAccountPassword, backfillAuthForActiveAccounts, backfillBusinessAppMetadata, setAccountPermission, setAccountTimecard, deleteAccount } from "@/app/settings/account-actions";
import { permissionOf, PERMISSION_LABEL, type PermissionLevel } from "@/lib/roles";
import { setMemberKpiRole } from "@/lib/kpi-roles-actions";
import type { KpiRoleKey } from "@/lib/kpi-roles";

// 権限バッジの色。管理=赤系 / マネージャー=青系 / メンバー=グレー系。
const PERM_BADGE: Record<PermissionLevel, { fg: string; bg: string; bd: string }> = {
  admin:   { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" },
  manager: { fg: "#0b5cab", bg: "#e7f0fb", bd: "#cfe0f5" },
  member:  { fg: "#475569", bg: "#f1f5f9", bd: "#e2e8f0" },
};

const STATUS_BADGE: Record<string, { l: string; c: string; bg: string }> = {
  pending: { l: "承認待ち", c: "#b45309", bg: "#fff6e0" },
  active: { l: "有効", c: "#067647", bg: "#e7f7ee" },
  disabled: { l: "無効", c: "#b42318", bg: "#fdecef" },
};

const fmtDate = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const permOf = (a: Account): PermissionLevel => permissionOf(a.role, a.team_role);

export function ApprovalsView({ accounts }: { accounts: Account[]; agents?: { email: string | null; name: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 状態（承認待ち/承認済み/すべて）。既定は「承認待ちがあれば承認待ち」。
  const hasPending = accounts.some((a) => a.status === "pending");
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "all">(hasPending ? "pending" : "all");
  const [hoverId, setHoverId] = useState<string | null>(null);
  // 詳細ドロワー（1件ぶんの編集）。
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerIn, setDrawerIn] = useState(false);
  // 一括選択・削除
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // エージェント追加・仮パスワード・一括修復
  const [showCreate, setShowCreate] = useState(false);
  const [cred, setCred] = useState<{ email: string; password: string; note: string } | null>(null);
  const [backfill, setBackfill] = useState<{ made: { email: string; password?: string }[]; failed: { email: string; error?: string }[] } | null>(null);

  const pendingCount = accounts.filter((a) => a.status === "pending").length;
  const approvedCount = accounts.length - pendingCount;
  // 表示行：状態フィルタ、承認待ち優先→新しい順。
  const rows = useMemo(() => accounts
    .filter((a) => statusFilter === "all" ? true : statusFilter === "pending" ? a.status === "pending" : a.status !== "pending")
    .sort((a, b) => {
      const pa = a.status === "pending" ? 0 : 1, pb = b.status === "pending" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(b.created_at).localeCompare(String(a.created_at));
    }), [accounts, statusFilter]);

  const runCred = (fn: () => Promise<{ ok: boolean; password?: string; email?: string; error?: string }>, email: string, note: string) => {
    setBusyId(email); setMsg(null);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      if (!res.ok) { setMsg({ ok: false, text: res.error || "操作に失敗しました" }); return; }
      if (res.password) setCred({ email: res.email || email, password: res.password, note });
      else setMsg({ ok: true, text: note });
      router.refresh();
    });
  };
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
    run(a.id, () => approveAccount(fd), `${a.name || a.email} を承認しました`);
  };

  // 選択
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const visibleIds = rows.map((r) => r.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allChecked) for (const id of visibleIds) n.delete(id); else for (const id of visibleIds) n.add(id); return n; });
  // 実際に削除・件数表示の対象は「今表示されている選択行」のみ。
  const selectedVisible = rows.filter((r) => selected.has(r.id));

  const performBulkDelete = async () => {
    if (selectedVisible.length === 0) { setConfirmOpen(false); return; }
    setBulkBusy(true); setMsg(null);
    const targets = selectedVisible.map((r) => ({ id: r.id, email: r.email ?? null }));
    const res = await bulkDeleteAccounts(targets);
    setBulkBusy(false); setConfirmOpen(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error || "削除に失敗しました" }); return; }
    const errPart = res.errors.length > 0 ? `（失敗 ${res.errors.length} 件：${res.errors.map((e) => e.error).join(" / ")}）` : "";
    setMsg({ ok: res.deleted > 0, text: `削除 ${res.deleted} 件 ${errPart}` });
    setSelected(new Set()); setDrawerId(null);
    router.refresh();
  };

  // ドロワー開閉
  const openDrawer = (id: string) => { setDrawerId(id); setTimeout(() => setDrawerIn(true), 0); };
  const closeDrawer = () => { setDrawerIn(false); setTimeout(() => setDrawerId(null), 200); };
  const drawerAccount = drawerId ? accounts.find((a) => a.id === drawerId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 管理者向けツールバー */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {/* LP側の「apps に business が無い→フリーランス画面」ルーティングに備え、既存の全法人
            アカウントの認証情報に business フラグを一括付与（バックフィル）する。完了件数を表示。 */}
        <button type="button" disabled={pending} onClick={() => {
          if (!confirm("既存の全ビジネスアカウント（社内・企業・パートナー・副業）の認証情報に\n『business』フラグ（app_metadata.apps）を一括付与します。\n\nLP（enger.jp）が『business が無い→フリーランス画面』で振り分けるため、\n法人ユーザーが正しくビジネス側へ入るのに必要です。よろしいですか？")) return;
          start(async () => {
            const r = await backfillBusinessAppMetadata();
            if (!r.ok) { setMsg({ ok: false, text: r.error ?? "付与に失敗しました" }); return; }
            const parts = [`対象 ${r.total} 件中 ${r.marked} 件に付与完了`];
            if ((r.noAuth ?? 0) > 0) parts.push(`未ログイン(auth未作成) ${r.noAuth} 件は「ログイン不可を一括修復」後に再実行を`);
            if ((r.failed ?? 0) > 0) parts.push(`失敗 ${r.failed} 件`);
            setMsg({ ok: (r.failed ?? 0) === 0, text: `🏷 businessフラグ：${parts.join(" ／ ")}` });
          });
        }}
          title="既存の法人アカウントに business フラグ（apps）を一括付与。LP側の振り分けに必要"
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #bae6fd", background: "#f0f9ff", color: "#0369a1", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          🏷 businessフラグを一括付与
        </button>
        <button type="button" disabled={pending} onClick={async () => {
          if (!confirm("ログイン用パスワードが未発行の有効アカウントについて、仮パスワードを一括発行します。\n発行直後のみ画面に表示されます。本人に共有後、各自で変更してもらってください。よろしいですか？")) return;
          start(async () => {
            const r = await backfillAuthForActiveAccounts();
            if (!r.ok) { setMsg({ ok: false, text: r.error ?? "一括発行に失敗しました" }); return; }
            const made = (r.results ?? []).filter((x) => x.password);
            const failed = (r.results ?? []).filter((x) => x.error);
            if (made.length === 0 && failed.length === 0) { setMsg({ ok: true, text: "発行が必要なアカウントはありませんでした（全員ログイン可能です）" }); return; }
            setBackfill({ made, failed });
          });
        }}
          title="auth に居ないアカウント全員に仮パスワードを発行します"
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", color: "#0b5cab", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          🔧 ログイン不可を一括修復
        </button>
        <button type="button" onClick={() => setShowCreate((v) => !v)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--color-brand-600, #0095D9)", background: showCreate ? "var(--color-brand-50, #eaf4fd)" : "#fff", color: "var(--color-brand-700, #0b5cab)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {showCreate ? "× 閉じる" : "＋ エージェント追加"}
        </button>
      </div>

      {/* 仮パスワード（1回限り表示） */}
      {cred && (
        <div style={{ background: "#ecfdf3", border: "1px solid #abefc6", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#067647", marginBottom: 6 }}>✅ {cred.note}</div>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>本人に下記を伝えてください。<b>このパスワードは今だけ表示されます</b>（再表示不可・初回ログイン後に本人が変更）。</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>メール</span>
            <code style={{ fontSize: 13, background: "#fff", border: "1px solid #d1fadf", borderRadius: 6, padding: "5px 9px" }}>{cred.email}</code>
            <span style={{ fontSize: 12, color: "#64748b" }}>仮パスワード</span>
            <code style={{ fontSize: 13, fontWeight: 700, background: "#fff", border: "1px solid #d1fadf", borderRadius: 6, padding: "5px 9px", letterSpacing: ".02em" }}>{cred.password}</code>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(`${cred.email} / ${cred.password}`); }}
              style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #abefc6", background: "#fff", fontSize: 11.5, fontWeight: 700, color: "#067647", cursor: "pointer" }}>コピー</button>
            <button type="button" onClick={() => setCred(null)}
              style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid var(--color-border)", background: "#fff", fontSize: 11.5, cursor: "pointer", color: "#6b7280", marginLeft: "auto" }}>閉じる</button>
          </div>
        </div>
      )}

      {/* 一括修復の結果 */}
      {backfill && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0b5cab" }}>🔧 ログイン不可アカウントを修復しました（{backfill.made.length} 件）</div>
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(backfill.made.map((x) => `${x.email} / ${x.password}`).join("\n")); }}
              style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid #bfdbfe", background: "#fff", fontSize: 11, fontWeight: 700, color: "#0b5cab", cursor: "pointer" }}>全てコピー</button>
            <button type="button" onClick={() => setBackfill(null)}
              style={{ padding: "4px 9px", borderRadius: 6, border: "1px solid var(--color-border)", background: "#fff", fontSize: 11, cursor: "pointer", color: "#6b7280", marginLeft: "auto" }}>閉じる</button>
          </div>
          <div style={{ fontSize: 11.5, color: "#475569", marginBottom: 8 }}>下記の仮パスワードを本人に共有してください。<b>この画面を閉じると再表示はできません</b>。</div>
          {backfill.made.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid #dbeafe", borderRadius: 6, padding: 8 }}>
              {backfill.made.map((x) => (
                <div key={x.email} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "center" }}>
                  <code style={{ flex: 1 }}>{x.email}</code>
                  <code style={{ fontWeight: 700, color: "#0b5cab" }}>{x.password}</code>
                </div>
              ))}
            </div>
          )}
          {backfill.failed.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#b42318" }}>失敗 {backfill.failed.length} 件：{backfill.failed.map((f) => f.email).join(", ")}</div>
          )}
        </div>
      )}

      {/* 新規エージェント作成フォーム */}
      {showCreate && (
        <form action={(fd) => runCred(() => createAgent(fd), String(fd.get("email") ?? ""), "アカウントを作成しました")}
          style={{ background: "var(--color-brand-25, #f5fbff)", border: "1px solid var(--color-brand-100, #cfe9fb)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input name="name" placeholder="氏名" style={{ flex: 1, minWidth: 140, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }} />
            <input name="email" type="email" required placeholder="メールアドレス（ログインID）" style={{ flex: 2, minWidth: 200, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }} />
            {/* 権限：メンバー=agent / 管理=admin（マネージャーは作成後にドロワーで設定） */}
            <select name="role" defaultValue="agent" title="権限（メンバー/管理）" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12.5 }}>
              <option value="agent">メンバー</option>
              <option value="admin">管理</option>
            </select>
            <input type="hidden" name="position" value="" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="submit" disabled={pending} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--color-brand-600, #0095D9)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
              {pending ? "作成中…" : "作成して仮パスワードを発行"}
            </button>
            <span className="muted" style={{ fontSize: 11 }}>仮パスワードは自動生成され、作成後に1回だけ表示されます。マネージャー権限は作成後に一覧から設定できます。</span>
          </div>
        </form>
      )}

      {/* 状態タブ（承認待ち / 承認済み / すべて） */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div role="tablist" aria-label="状態" style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {([
            { k: "pending",  label: "承認待ち", n: pendingCount,  fg: "#b45309", bg: "#fff6e0" },
            { k: "approved", label: "承認済み", n: approvedCount, fg: "#067647", bg: "#e7f7ee" },
            { k: "all",      label: "すべて",   n: pendingCount + approvedCount, fg: "var(--color-ink)", bg: "var(--color-surface)" },
          ] as const).map((s) => {
            const on = statusFilter === s.k;
            return (
              <button key={s.k} type="button" role="tab" aria-selected={on} onClick={() => { setStatusFilter(s.k); setSelected(new Set()); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 99, fontFamily: "inherit",
                  background: on ? "var(--color-surface)" : "transparent", color: on ? s.fg : "var(--color-ink-3)",
                  boxShadow: on ? "0 1px 2px rgba(15,23,42,0.08)" : "none", fontSize: 12.5, fontWeight: on ? 800 : 600, border: 0, cursor: "pointer" }}>
                {s.label}
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 99, background: on ? s.bg : "var(--color-surface)", color: on ? s.fg : "var(--color-ink-4)" }}>{s.n}</span>
              </button>
            );
          })}
        </div>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}

      {/* 一覧（1枚のリスト）。行ホバーでハイライト・クリックでドロワーが開く。 */}
      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30, fontSize: 13 }}>
          該当する登録はありません。
        </div>
      ) : (
        <div className="card" style={{ padding: 12 }}>
          {/* 全選択 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 10px", borderBottom: "1px solid var(--color-border)", marginBottom: 8 }}>
            <input type="checkbox" aria-label="表示行をすべて選択" checked={allChecked}
              ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }} onChange={toggleAll} style={{ accentColor: "var(--color-brand-600)" }} />
            <span className="muted" style={{ fontSize: 11.5 }}>{rows.length} 件{selected.size > 0 ? `／${selected.size} 件選択中` : ""}・行をクリックすると権限・PW再発行・削除などの編集パネルが開きます</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((a) => {
              const perm = permOf(a);
              const pb = PERM_BADGE[perm];
              const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
              const checked = selected.has(a.id);
              const busy = busyId === a.id && pending;
              const hovered = hoverId === a.id;
              return (
                <div key={a.id}
                  role="button" tabIndex={0} aria-label={`${a.name ?? a.email} の詳細を開く`}
                  onClick={() => openDrawer(a.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(a.id); } }}
                  onMouseEnter={() => setHoverId(a.id)} onMouseLeave={() => setHoverId((v) => (v === a.id ? null : v))}
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    background: checked ? "var(--color-brand-25, #f0f6ff)" : hovered ? "var(--color-surface-soft, #f8fafc)" : "var(--color-surface)",
                    border: `1px solid ${hovered ? "var(--color-brand-200, #b6dcf5)" : "var(--color-border)"}`,
                    boxShadow: hovered ? "0 2px 8px rgba(15,23,42,.06)" : "none", transition: "background .12s, border-color .12s, box-shadow .12s" }}>
                  <input type="checkbox" aria-label={`${a.name ?? a.email} を選択`} checked={checked}
                    onClick={(e) => e.stopPropagation()} onChange={() => toggleOne(a.id)}
                    style={{ accentColor: "var(--color-brand-600)", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 99, background: pb.bg, color: pb.fg, border: `1px solid ${pb.bd}`, flexShrink: 0 }}>{PERMISSION_LABEL[perm]}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, color: sb.c, background: sb.bg, flexShrink: 0 }}>{sb.l}</span>
                  <b style={{ fontSize: 12.5 }}>{a.name || "（名前未設定）"}</b>
                  <span className="muted mono" style={{ fontSize: 11 }}>{a.email}</span>
                  <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }} title={a.created_at}>{fmtDateTime(a.created_at)}</span>
                  {a.status === "pending" && (
                    <button type="button" className="btn btn-xs" disabled={busy}
                      onClick={(e) => { e.stopPropagation(); doApprove(a); }} title="エージェントとして承認します"
                      style={{ background: "#067647", borderColor: "#067647", color: "#fff", flexShrink: 0 }}>
                      {busy ? "処理中…" : "承認"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 一括操作バー（表示中の選択が1件以上で出現） */}
      {selectedVisible.length > 0 && (
        <div role="region" aria-label="一括操作"
          style={{ position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 50, marginTop: 6, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "12px 16px", borderRadius: 12, background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", boxShadow: "0 -8px 24px rgba(15,23,42,.12)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1, color: "var(--color-brand-600)" }}>check_box</span>
            {selectedVisible.length} 件選択中
          </span>
          <button type="button" className="btn ghost btn-xs" onClick={() => setSelected(new Set())} disabled={bulkBusy}>選択を解除</button>
          <span style={{ flex: 1 }} />
          <button type="button" disabled={bulkBusy} onClick={() => setConfirmOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, border: 0, background: "var(--color-danger, #b42318)", color: "#fff", fontWeight: 800, fontSize: 13, fontFamily: "inherit", cursor: "pointer", boxShadow: "0 6px 14px rgba(180,35,24,.25)" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>delete</span>
            選択した {selectedVisible.length} 件を削除
          </button>
        </div>
      )}

      {/* 削除確認モーダル */}
      {confirmOpen && (
        <div onClick={() => !bulkBusy && setConfirmOpen(false)} role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 600, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 480, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28, color: "var(--color-danger, #b42318)" }}>warning</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{selectedVisible.length} 件のアカウントを削除します</h3>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.7 }}>
              この操作は取り消せません。<b>app_users / public.profiles / Supabase Auth</b> のうち該当する行を可能な範囲で連動削除します。本人がログイン中の場合はセッションが切れます。続行しますか？
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn ghost btn-xs" onClick={() => setConfirmOpen(false)} disabled={bulkBusy}>キャンセル</button>
              <button type="button" onClick={performBulkDelete} disabled={bulkBusy}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: 0, background: "var(--color-danger, #b42318)", color: "#fff", fontWeight: 800, fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>delete</span>
                {bulkBusy ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 詳細ドロワー（シンプル構成：状態・権限・メモ・その他設定・PW再発行・削除） */}
      {drawerAccount && (() => {
        const a = drawerAccount;
        const perm = permOf(a);
        const pb = PERM_BADGE[perm];
        const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
        const busy = busyId === a.id && pending;
        const editable = a.status !== "pending";
        return (
          <div onClick={closeDrawer} style={{ position: "fixed", inset: 0, zIndex: 700, background: drawerIn ? "rgba(15,36,64,.4)" : "transparent", transition: "background .18s ease-out" }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="card"
              style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(480px, 96vw)", maxHeight: "100vh", overflowY: "auto", padding: 0, borderRadius: 0, background: "var(--color-surface)", boxShadow: "-14px 0 34px rgba(15,23,42,.2)", transform: drawerIn ? "translateX(0)" : "translateX(100%)", transition: "transform .24s cubic-bezier(.2,.7,.2,1)" }}>
              {/* ヘッダ */}
              <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "14px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 99, background: pb.bg, color: pb.fg, border: `1px solid ${pb.bd}` }}>{PERMISSION_LABEL[perm]}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, color: sb.c, background: sb.bg }}>{sb.l}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{a.name || "（名前未設定）"}</div>
                  <div className="muted mono" style={{ fontSize: 12 }}>{a.email}</div>
                </div>
                <button type="button" className="btn ghost" onClick={closeDrawer} aria-label="閉じる" style={{ fontSize: 16, padding: "6px 10px" }}>×</button>
              </div>

              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                {/* 状態アクション */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {a.status === "pending" && (
                    <button type="button" className="btn brand" disabled={busy} onClick={() => doApprove(a)}>{busy ? "処理中…" : "✓ 承認する"}</button>
                  )}
                  {a.status === "active" && (
                    <button type="button" className="btn ghost" disabled={busy} style={{ color: "var(--color-danger)" }} onClick={() => run(a.id, () => setAccountStatus(a.id, "disabled"), "無効化しました（ログイン停止）")}>ログインを停止（無効化）</button>
                  )}
                  {a.status === "disabled" && (
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => run(a.id, () => setAccountStatus(a.id, "active"), "再有効化しました")}>再有効化</button>
                  )}
                </div>

                {a.status === "pending" && (
                  <div style={{ background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#9a7b12" }}>
                    ⏳ このアカウントは <b>承認待ち</b> です。権限などの編集は<b>承認後</b>に有効化されます。
                  </div>
                )}

                {/* 権限（メンバー / マネージャー / 管理） */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-ink-2)" }}>権限</div>
                  <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                    {(["member", "manager", "admin"] as const).map((lv) => {
                      const on = perm === lv;
                      const dis = busy || !editable;
                      return (
                        <button key={lv} type="button" disabled={dis}
                          onClick={() => { if (!on) run(a.id, () => setAccountPermission(a.id, lv), `権限を「${PERMISSION_LABEL[lv]}」にしました`); }}
                          style={{ padding: "6px 14px", borderRadius: 99, fontSize: 12.5, fontFamily: "inherit", cursor: dis ? "not-allowed" : "pointer", fontWeight: 700,
                            border: "1px solid", borderColor: on ? "var(--color-brand-600)" : "var(--color-border)",
                            background: on ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)" }}>
                          {PERMISSION_LABEL[lv]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>
                    メンバー＝マッチング〜提案管理まで利用可 ／ マネージャー＝＋提案の承認・チーム日報 ／ 管理＝＋設定・ユーザー管理
                  </div>
                </div>

                {/* メモ */}
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>メモ
                  <input type="text" defaultValue={(a as any).note ?? ""} disabled={busy || !editable} placeholder="担当領域・連絡メモなど"
                    onBlur={(e) => { const v = e.target.value.trim(); const cur = ((a as any).note ?? "") as string; if (v !== cur) run(a.id, () => setAccountNote(a.id, v), "メモを保存しました"); }}
                    style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
                </label>

                {/* その他設定（KPIチーム・タイムカード）。使用頻度が低いのでコンパクトに1行へ。 */}
                {editable && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px" }}>
                    <span className="muted" style={{ fontSize: 10.5 }}>KPIチーム：</span>
                    <select defaultValue={(a.kpi_role ?? a.position) ?? ""} disabled={busy} title="KPI/KGI のチーム（アウトサイド/インサイド）。" onChange={(e) => run(a.id, () => setMemberKpiRole(a.email, e.target.value as KpiRoleKey | ""), "KPIチームを変更しました")} style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 11.5 }}>
                      <option value="">未設定</option>
                      <option value="outside">アウトサイド</option>
                      <option value="inside">インサイド</option>
                      {a.kpi_role === "telapo" && <option value="telapo">テレアポ</option>}
                    </select>
                    <label title="バイト/副業向けのタイムカード（本人打刻）を有効化" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-ink-3)", cursor: "pointer" }}>
                      <input type="checkbox" defaultChecked={!!(a as any).is_timecard_user} disabled={busy} onChange={(e) => run(a.id, () => setAccountTimecard(a.id, e.target.checked), "タイムカード設定を保存しました")} />
                      タイムカード
                    </label>
                  </div>
                )}

                {/* 承認履歴 */}
                <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>
                  登録 {fmtDate(a.created_at)}
                  {a.approved_at ? <> ・ 承認 {fmtDate(a.approved_at)} <span className="muted">by {a.approved_by_name || a.approved_by_email || "—"}</span></> : <span className="muted"> ・ 未承認</span>}
                </div>

                {/* 破壊的操作 */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
                  {editable && (
                    <button type="button" disabled={busy} onClick={() => { if (confirm(`${a.email} のパスワードを再発行しますか？新しい仮パスワードが表示され、現在のパスワードは無効になります。`)) runCred(() => resetAccountPassword(a.email), a.email, "パスワードを再発行しました"); }}
                      style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#0b5cab" }}>🔑 PW再発行</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => { if (confirm(`${a.email} を削除しますか？この操作は取り消せません。`)) { run(a.id, () => deleteAccount(a.id), "削除しました"); closeDrawer(); } }}
                    style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #f7c5cf", background: "#fdecef", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#b42318", marginLeft: "auto" }}>× このアカウントを削除</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
