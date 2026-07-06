"use client";

// ユーザー管理（新規登録の承認・区分管理）。
//   1枚のリストに全アカウントを表示し、区分（社内/法人/個人）と状態（承認待ち/承認済み）のタブで絞り込む。
//   各行はバッジで「法人／個人／社内」＋区分が一目でわかり、その場で承認できる。
//   詳細（区分変更・担当・メモ・面談済み・権限編集・PW再発行・削除・メール/面談履歴）は右のドロワーで行う。
//   チェックボックスで複数選択→一括削除。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account, Role } from "@/lib/accounts";
import { approveAccount, bulkDeleteAccounts, setAccountStatus, setAccountRole, setAccountMeetingDone, setAccountOwnerAgent, setAccountNote, getAccountActivity, createAgent, resetAccountPassword, backfillAuthForActiveAccounts, backfillBusinessAppMetadata, setAccountDepartment, setAccountTeamRole, setAccountFunctions, setAccountTimecard, deleteAccount } from "@/app/settings/account-actions";
import { ApprovalDetailPanel } from "./ApprovalDetailPanel";
import { detectSuspicion } from "@/lib/account-suspicion";
import { FUNCTIONS, DEPARTMENTS, TEAM_ROLES, TEAM_ROLE_LABEL } from "@/lib/roles";
import { setMemberKpiRole } from "@/lib/kpi-roles-actions";
import type { KpiRoleKey } from "@/lib/kpi-roles";

type TabKey = "candidate" | "client" | "partner" | "freelance" | "agent" | "backoffice" | "admin";
type KindType = "社内" | "法人" | "個人";
type KindFilter = "all" | KindType;

const TAB_META: Record<TabKey, { label: string; role: Role; hint: string }> = {
  agent:      { label: "エージェント",   role: "agent",     hint: "社内の営業メンバー。承認すると営業業務（マッチング・提案等）を利用できます。" },
  backoffice: { label: "バックオフィス", role: "agent",     hint: "社内のバックオフィス職（部署=バックオフィス／職能=バックオフィスのみ）。営業業務メニューは非表示。" },
  admin:      { label: "管理者",         role: "admin",     hint: "社内の管理者。全機能にアクセスできます。" },
  candidate:  { label: "エンジニア",       role: "candidate", hint: "enger.jp(LP)から登録した人材。承認すると人材ダッシュボードを利用できます。" },
  client:     { label: "企業",            role: "client",    hint: "LPから登録したエンド企業。承認すると自社ポータル（案件掲載・おすすめ人材・選考）を利用できます。" },
  partner:    { label: "パートナー企業",   role: "partner",   hint: "LPから登録した社外パートナー。自社＋共有でマッチング（他社情報は匿名表示で漏洩防止）。" },
  freelance:  { label: "副業エージェント", role: "freelance", hint: "ag.enger.jp から登録した個人。自分＋共有でマッチング（他社は匿名表示で漏洩防止）。" },
};

// 区分ごとの表示バッジ。法人／個人／社内 の性質チップ＋区分名チップの2段構え。
const KIND_BADGE: Record<TabKey, { label: string; type: KindType; fg: string; bg: string; bd: string }> = {
  client:     { label: "企業",              type: "法人", fg: "#0b5cab", bg: "#e7f0fb", bd: "#cfe0f5" },
  partner:    { label: "パートナー企業",     type: "法人", fg: "#7c3aed", bg: "#f3e8ff", bd: "#ddd6fe" },
  freelance:  { label: "副業エージェント",   type: "個人", fg: "#0d9488", bg: "#e6fffa", bd: "#99f6e4" },
  candidate:  { label: "エンジニア（LP人材）", type: "個人", fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" },
  agent:      { label: "営業",              type: "社内", fg: "#0095D9", bg: "#e0f2fe", bd: "#bae6fd" },
  backoffice: { label: "バックオフィス",     type: "社内", fg: "#6b7280", bg: "#f3f4f6", bd: "#e5e7eb" },
  admin:      { label: "管理者",            type: "社内", fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" },
};
const KIND_TYPE_TONE: Record<KindType, { fg: string; bg: string }> = {
  法人: { fg: "#3730a3", bg: "#eef2ff" },
  個人: { fg: "#065f46", bg: "#ecfdf5" },
  社内: { fg: "#475569", bg: "#f8fafc" },
};

// 区分タブ（絞り込み）。すべて＋性質3種。
const KIND_TABS: { key: KindFilter; label: string; icon: string }[] = [
  { key: "all", label: "すべて",   icon: "group" },
  { key: "社内", label: "社内",     icon: "badge" },
  { key: "法人", label: "企業・法人", icon: "apartment" },
  { key: "個人", label: "個人",     icon: "person" },
];

/** agent ロールのうち「バックオフィス職」を判定（部署=バックオフィス、または職能がバックオフィスのみ）。 */
function isBackOffice(a: Account): boolean {
  if (a.role !== "agent") return false;
  if ((a.department ?? "").trim() === "バックオフィス") return true;
  const fns = a.functions ?? [];
  return fns.includes("バックオフィス") && !fns.includes("営業");
}
/** アカウントが属する表示用 TabKey を返す（agent はバックオフィス判定で振り分け）。 */
function tabOf(a: Account): TabKey {
  if (a.role === "agent") return isBackOffice(a) ? "backoffice" : "agent";
  return a.role as TabKey;
}
const kindTypeOf = (a: Account): KindType => KIND_BADGE[tabOf(a)].type;

const STATUS_BADGE: Record<string, { l: string; c: string; bg: string }> = {
  pending: { l: "承認待ち", c: "#b45309", bg: "#fff6e0" },
  active: { l: "有効", c: "#067647", bg: "#e7f7ee" },
  disabled: { l: "無効", c: "#b42318", bg: "#fdecef" },
};

const fmtDate = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const isLpVirtual = (id: string) => id.startsWith("profile:") || id.startsWith("auth:");

// LP由来（profile:/auth: の仮想行）の登録元ラベル。signup_source で色分け（dojo=橙／enger=青／不明=灰）。
const LP_ORIGIN: Record<string, { label: string; color: string }> = {
  dojo:  { label: "LP登録（無限道場）", color: "#d97706" },
  enger: { label: "LP登録（enger.jp）", color: "#0095D9" },
};
function lpOriginLabel(a: Account): { label: string; color: string } | null {
  if (!isLpVirtual(a.id)) return null;
  // business フラグで「企業(法人)」と判定された仮想行は LP登録ではないので、
  //   ビジネス登録（app_users 未作成）である旨を出す（「LP登録」は誤解を招くため出さない）。
  if (a.role === "client" || a.role === "partner") return { label: "ビジネス登録（未承認）", color: "#0b5cab" };
  const ss = (a as any).signup_source as string | null | undefined;
  return ss && LP_ORIGIN[ss] ? LP_ORIGIN[ss] : { label: "LP登録（不明）", color: "#94a3b8" };
}

export function ApprovalsView({ accounts, agents = [] }: { accounts: Account[]; agents?: { email: string | null; name: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 絞り込み：区分（すべて/社内/法人/個人）＋状態（承認待ち/承認済み/すべて）。
  //   既定は「承認待ちがあれば承認待ち」。無ければ「すべて」。
  const hasPending = accounts.some((a) => a.status === "pending");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "all">(hasPending ? "pending" : "all");
  // 詳細ドロワー（1件ぶんの編集）。
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerIn, setDrawerIn] = useState(false);
  const [activity, setActivity] = useState<Record<string, { emails: any[]; meetings: any[] }>>({});
  // 一括選択・削除
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // エージェント追加・仮パスワード・一括修復
  const [showCreate, setShowCreate] = useState(false);
  const [cred, setCred] = useState<{ email: string; password: string; note: string } | null>(null);
  const [backfill, setBackfill] = useState<{ made: { email: string; password?: string }[]; failed: { email: string; error?: string }[] } | null>(null);

  // 区分別の承認待ち件数（タブのバッジ）。
  const pendingByKind = useMemo(() => {
    const m: Record<KindFilter, number> = { all: 0, 社内: 0, 法人: 0, 個人: 0 };
    for (const a of accounts) if (a.status === "pending") { m.all++; m[kindTypeOf(a)]++; }
    return m;
  }, [accounts]);

  // 区分のみで絞った集合（状態タブのバッジ件数はここから数える＝選択中の状態タブに依存しない）。
  const kindOnly = useMemo(() => accounts.filter((a) => kindFilter === "all" ? true : kindTypeOf(a) === kindFilter), [accounts, kindFilter]);
  const kindPending = kindOnly.filter((a) => a.status === "pending").length;
  const kindApproved = kindOnly.length - kindPending;
  // 表示行：区分＋状態フィルタ、承認待ち優先→新しい順。
  const rows = useMemo(() => kindOnly
    .filter((a) => statusFilter === "all" ? true : statusFilter === "pending" ? a.status === "pending" : a.status !== "pending")
    .sort((a, b) => {
      // 承認待ちを上に、その中で新しい順。
      const pa = a.status === "pending" ? 0 : 1, pb = b.status === "pending" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return String(b.created_at).localeCompare(String(a.created_at));
    }), [kindOnly, statusFilter]);

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
    if (a.company_name) fd.set("company_name", a.company_name);
    if (isLpVirtual(a.id)) { fd.set("email", a.email); if (a.name) fd.set("name", a.name); }
    run(a.id, () => approveAccount(fd), `${a.name || a.email} を承認しました`);
  };

  // 怪しさ判定・同一メール別区分の検知（バッジ＆一括選択に使用）。
  const suspicionMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof detectSuspicion>>();
    for (const a of accounts) m.set(a.id, detectSuspicion(a as any));
    return m;
  }, [accounts]);
  const crossRoleMap = useMemo(() => {
    const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
    const byEmail = new Map<string, { tab: TabKey; label: string; status: string; name: string | null }[]>();
    for (const a of accounts) {
      const em = norm(a.email);
      if (!em) continue;
      const arr = byEmail.get(em) ?? [];
      arr.push({ tab: tabOf(a), label: TAB_META[tabOf(a)].label, status: a.status, name: a.name ?? null });
      byEmail.set(em, arr);
    }
    const m = new Map<string, { tab: TabKey; label: string; status: string; name: string | null }[]>();
    for (const [em, list] of byEmail) if (new Set(list.map((x) => x.tab)).size >= 2) m.set(em, list);
    return m;
  }, [accounts]);
  const crossRoleFor = (a: Account) => {
    const em = (a.email ?? "").trim().toLowerCase();
    if (!em) return null;
    const list = crossRoleMap.get(em);
    if (!list) return null;
    const others = list.filter((x) => x.tab !== tabOf(a));
    return others.length > 0 ? others : null;
  };
  const suspectCount = rows.filter((a) => suspicionMap.get(a.id)).length;
  const crossCount = rows.filter((a) => crossRoleFor(a)).length;

  // 選択
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const visibleIds = rows.map((r) => r.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allChecked) for (const id of visibleIds) n.delete(id); else for (const id of visibleIds) n.add(id); return n; });
  const selectWhere = (pred: (a: Account) => boolean) => setSelected(new Set(rows.filter(pred).map((a) => a.id)));
  // 実際に削除・件数表示の対象は「今表示されている選択行」のみ。承認等でリストから外れた
  //   （非表示になった）選択IDが state に残っていても、それを誤って一括削除しないための安全策。
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

  // ドロワー開閉（開いたら活動履歴を遅延取得）。
  const openDrawer = (id: string) => {
    setDrawerId(id);
    setTimeout(() => setDrawerIn(true), 0);
    if (!isLpVirtual(id) && !activity[id]) {
      getAccountActivity(id).then((res) => { if (res.ok) setActivity((m) => ({ ...m, [id]: { emails: res.emails, meetings: res.meetings } })); }).catch(() => {});
    }
  };
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
            <input type="hidden" name="position" value="" />
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
            <button type="submit" disabled={pending} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--color-brand-600, #0095D9)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
              {pending ? "作成中…" : "作成して仮パスワードを発行"}
            </button>
            <span className="muted" style={{ fontSize: 11 }}>仮パスワードは自動生成され、作成後に1回だけ表示されます。</span>
          </div>
        </form>
      )}

      {/* 区分タブ（すべて / 社内 / 企業・法人 / 個人） */}
      <div role="tablist" aria-label="区分" style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, alignSelf: "flex-start", flexWrap: "wrap" }}>
        {KIND_TABS.map((t) => {
          const on = kindFilter === t.key;
          const pc = pendingByKind[t.key] ?? 0;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => { setKindFilter(t.key); setSelected(new Set()); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 9, border: 0, cursor: "pointer", fontFamily: "inherit",
                background: on ? "var(--color-surface)" : "transparent", color: on ? "var(--color-brand-700)" : "var(--color-ink-3)",
                boxShadow: on ? "0 1px 3px rgba(15,23,42,0.10)" : "none", fontSize: 14, fontWeight: on ? 800 : 600 }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
              <span>{t.label}</span>
              {pc > 0 && <span className="badge hot" style={{ fontSize: 10, padding: "1px 7px" }}>{pc}</span>}
            </button>
          );
        })}
      </div>

      {/* 状態タブ（承認待ち / 承認済み / すべて）＋ 一括選択の導線 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div role="tablist" aria-label="状態" style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 99 }}>
          {([
            { k: "pending",  label: "承認待ち", n: kindPending,  fg: "#b45309", bg: "#fff6e0" },
            { k: "approved", label: "承認済み", n: kindApproved, fg: "#067647", bg: "#e7f7ee" },
            { k: "all",      label: "すべて",   n: kindPending + kindApproved, fg: "var(--color-ink)", bg: "var(--color-surface)" },
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
        <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          {crossCount > 0 && (
            <button type="button" onClick={() => selectWhere((a) => !!crossRoleFor(a))} title="同じメールが別区分にも登録されているレコードを選択します"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 99, background: "#fff5e6", color: "#9a3412", border: "1px solid #fed7aa", cursor: "pointer", fontFamily: "inherit" }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>group_remove</span>
              別区分にも登録あり {crossCount} 件
            </button>
          )}
          {suspectCount > 0 && (
            <button type="button" onClick={() => selectWhere((a) => !!suspicionMap.get(a.id))} title="怪しさを検知した行のみ選択します"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 99, background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf", cursor: "pointer", fontFamily: "inherit" }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>warning</span>
              怪しい登録 {suspectCount} 件（クリックで選択）
            </button>
          )}
        </div>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}

      {/* 一覧（1枚のリスト）。行クリック（またはボタン）でドロワーを開いて編集。 */}
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
            <span className="muted" style={{ fontSize: 11.5 }}>{rows.length} 件{selected.size > 0 ? `／${selected.size} 件選択中` : ""}・行の「詳細」で区分変更・権限・削除ができます</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((a) => {
              const b = KIND_BADGE[tabOf(a)];
              const t = KIND_TYPE_TONE[b.type];
              const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
              const sus = suspicionMap.get(a.id);
              const cross = crossRoleFor(a);
              const checked = selected.has(a.id);
              const busy = busyId === a.id && pending;
              return (
                <div key={a.id}
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 12px", borderRadius: 10,
                    background: checked ? "var(--color-brand-25, #f0f6ff)" : "var(--color-surface)",
                    border: `1px solid ${sus?.level === "danger" ? "#f7c5cf" : sus ? "#fde9b0" : "var(--color-border)"}` }}>
                  <input type="checkbox" aria-label={`${a.name ?? a.email} を選択`} checked={checked} onChange={() => toggleOne(a.id)} style={{ accentColor: "var(--color-brand-600)", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: t.bg, color: t.fg, border: "1px solid var(--color-border)", flexShrink: 0 }}>{b.type}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 99, background: b.bg, color: b.fg, border: `1px solid ${b.bd}`, flexShrink: 0 }}>{b.label}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, color: sb.c, background: sb.bg, flexShrink: 0 }}>{sb.l}</span>
                  <b style={{ fontSize: 12.5 }}>{a.name || "（名前未設定）"}</b>
                  <span className="muted mono" style={{ fontSize: 11 }}>{a.email}</span>
                  {a.company_name && <span className="muted" style={{ fontSize: 11 }}>{a.company_name}</span>}
                  {sus && (
                    <span title={sus.reasons.join(" / ")} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, color: sus.level === "danger" ? "#b42318" : "#92400e", background: sus.level === "danger" ? "#fdecef" : "#fff6e0", border: `1px solid ${sus.level === "danger" ? "#f7c5cf" : "#fde9b0"}` }}>
                      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>warning</span>
                      {sus.level === "danger" ? "スパム疑い" : "要確認"}
                    </span>
                  )}
                  {cross && (
                    <span title={`同じメールが別区分にも登録されています：\n${cross.map((x) => `・${x.label}（${STATUS_BADGE[x.status]?.l ?? x.status}）`).join("\n")}`} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, color: "#9a3412", background: "#fff5e6", border: "1px solid #fed7aa" }}>
                      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>group_remove</span>
                      別区分にも登録あり
                    </span>
                  )}
                  {(() => { const lp = lpOriginLabel(a); return lp ? <span style={{ fontSize: 9.5, fontWeight: 700, color: lp.color, flexShrink: 0 }} title="LPからの登録（signup_source）">{lp.label}</span> : null; })()}
                  <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }} title={a.created_at}>{fmtDateTime(a.created_at)}</span>
                  {a.status === "pending" && (
                    <button type="button" className="btn btn-xs" disabled={busy} onClick={() => doApprove(a)} title={`${b.label}として承認します`} style={{ background: "#067647", borderColor: "#067647", color: "#fff", flexShrink: 0 }}>
                      {busy ? "処理中…" : "承認"}
                    </button>
                  )}
                  <button type="button" className="btn ghost btn-xs" onClick={() => openDrawer(a.id)} title="区分変更・担当・メモ・権限・削除・履歴" style={{ flexShrink: 0 }}>詳細</button>
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
              この操作は取り消せません。<b>app_users / public.profiles / Supabase Auth</b> のうち該当する行を可能な範囲で連動削除します。本人がログイン中の場合はセッションが切れます。承認待ち以外の行も削除されます。続行しますか？
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

      {/* 詳細ドロワー（1件の編集：区分変更・担当・メモ・面談済み・権限・PW再発行・削除・履歴） */}
      {drawerAccount && (() => {
        const a = drawerAccount;
        const b = KIND_BADGE[tabOf(a)];
        const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
        const lpVirtual = isLpVirtual(a.id);
        const busy = busyId === a.id && pending;
        const editable = a.status !== "pending" && !lpVirtual;
        const isProper = b.type === "社内";
        const act = activity[a.id];
        return (
          <div onClick={closeDrawer} style={{ position: "fixed", inset: 0, zIndex: 700, background: drawerIn ? "rgba(15,36,64,.4)" : "transparent", transition: "background .18s ease-out" }}>
            <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" className="card"
              style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(560px, 96vw)", maxHeight: "100vh", overflowY: "auto", padding: 0, borderRadius: 0, background: "var(--color-surface)", boxShadow: "-14px 0 34px rgba(15,23,42,.2)", transform: drawerIn ? "translateX(0)" : "translateX(100%)", transition: "transform .24s cubic-bezier(.2,.7,.2,1)" }}>
              {/* ヘッダ */}
              <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)", padding: "14px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: KIND_TYPE_TONE[b.type].bg, color: KIND_TYPE_TONE[b.type].fg, border: "1px solid var(--color-border)" }}>{b.type}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 99, background: b.bg, color: b.fg, border: `1px solid ${b.bd}` }}>{b.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, color: sb.c, background: sb.bg }}>{sb.l}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{a.name || "（名前未設定）"}</div>
                  <div className="muted mono" style={{ fontSize: 12 }}>{a.email}</div>
                  {a.company_name && <div className="muted" style={{ fontSize: 12 }}>{a.company_name}</div>}
                  {(() => { const lp = lpOriginLabel(a); return lp ? <div style={{ fontSize: 10.5, fontWeight: 700, color: lp.color, marginTop: 2 }}>{lp.label}</div> : null; })()}
                </div>
                <button type="button" className="btn ghost" onClick={closeDrawer} aria-label="閉じる" style={{ fontSize: 16, padding: "6px 10px" }}>×</button>
              </div>

              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 状態アクション */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {a.status === "pending" && (
                    <button type="button" className="btn brand" disabled={busy} onClick={() => doApprove(a)}>{busy ? "処理中…" : "✓ 承認する"}</button>
                  )}
                  {a.status === "active" && (
                    <button type="button" className="btn ghost" disabled={busy} style={{ color: "var(--color-danger)" }} onClick={() => run(a.id, () => setAccountStatus(a.id, "disabled"), "無効化しました")}>無効化</button>
                  )}
                  {a.status === "disabled" && (
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => run(a.id, () => setAccountStatus(a.id, "active"), "再有効化しました")}>再有効化</button>
                  )}
                  {a.status === "active" && (a.role === "client" || a.role === "partner" || a.role === "freelance" || a.role === "candidate") && (
                    (a as any).meeting_done
                      ? <button type="button" className="btn ghost" disabled={busy} title="面談済みを取り消し（詳細を再制限）" onClick={() => run(a.id, () => setAccountMeetingDone(a.id, false), "面談済みを取り消しました")}>✓ 面談済み（取消）</button>
                      : <button type="button" className="btn" disabled={busy} style={{ background: "#067647", borderColor: "#067647", color: "#fff" }} onClick={() => run(a.id, () => setAccountMeetingDone(a.id, true), "面談済みにしました（詳細解放）")}>面談済みにする</button>
                  )}
                </div>

                {a.status === "pending" && (
                  <div style={{ background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 10, padding: "10px 12px", fontSize: 12, color: "#9a7b12" }}>
                    ⏳ このアカウントは <b>承認待ち</b> です。区分・担当・メモ・権限の編集は<b>承認後</b>に有効化されます。
                  </div>
                )}

                {/* 区分の付け替え */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-ink-2)" }}>区分</div>
                  {isProper ? (() => {
                    const fns = a.functions ?? [];
                    const isAdmin = a.role === "admin";
                    const dis = busy || !editable;
                    const pillBase: React.CSSProperties = { padding: "5px 12px", borderRadius: 99, fontSize: 12, fontFamily: "inherit", cursor: dis ? "not-allowed" : "pointer", fontWeight: 700, border: "1px solid" };
                    const pillOn: React.CSSProperties = { background: "var(--color-brand-600)", color: "#fff", borderColor: "var(--color-brand-600)" };
                    const pillOff: React.CSSProperties = { background: "var(--color-surface-inset)", color: "var(--color-ink-3)", borderColor: "var(--color-border)" };
                    const toggleFn = (fn: "営業" | "バックオフィス") => run(a.id, () => setAccountFunctions(a.id, fns.includes(fn) ? fns.filter((x) => x !== fn) : [...fns, fn]), `${fn}を${fns.includes(fn) ? "解除" : "付与"}しました`);
                    return (
                      <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" disabled={dis} onClick={() => toggleFn("営業")} style={{ ...pillBase, ...(fns.includes("営業") ? pillOn : pillOff) }}>営業</button>
                        <button type="button" disabled={dis} onClick={() => toggleFn("バックオフィス")} style={{ ...pillBase, ...(fns.includes("バックオフィス") ? pillOn : pillOff) }}>バックオフィス</button>
                        <button type="button" disabled={dis} onClick={() => run(a.id, () => setAccountRole(a.id, (isAdmin ? "agent" : "admin") as any), isAdmin ? "管理者を解除" : "管理者にしました")} style={{ ...pillBase, ...(isAdmin ? { background: "#b45309", color: "#fff", borderColor: "#b45309" } : pillOff) }}>管理者</button>
                      </span>
                    );
                  })() : (
                    <select defaultValue={a.role} disabled={busy || !editable}
                      onChange={(e) => run(a.id, () => setAccountRole(a.id, e.target.value as any), "区分を変更しました")}
                      style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", maxWidth: 240 }}>
                      <option value="client">企業</option>
                      <option value="partner">パートナー企業</option>
                      <option value="freelance">副業エージェント</option>
                      <option value="candidate">人材</option>
                      <option value="agent">営業</option>
                      <option value="admin">管理者</option>
                    </select>
                  )}
                </div>

                {/* 担当エージェント・メモ */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>担当エージェント
                    <select disabled={busy || !editable} defaultValue={(a as any).owner_agent_email ?? ""}
                      onChange={(e) => { const em = e.target.value || null; const ag = agents.find((x) => x.email === em); run(a.id, () => setAccountOwnerAgent(a.id, em, ag?.name ?? null), em ? `担当を ${ag?.name || em} に設定` : "担当をクリア"); }}
                      style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
                      <option value="">— 未割当 —</option>
                      {agents.map((ag) => <option key={ag.email ?? ag.name ?? ""} value={ag.email ?? ""}>{ag.name ?? ag.email}</option>)}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: "var(--color-ink-4)" }}>メモ（連絡・面談の根拠）
                    <input type="text" defaultValue={(a as any).note ?? ""} disabled={busy || !editable} placeholder="連絡・面談メモ"
                      onBlur={(e) => { const v = e.target.value.trim(); const cur = ((a as any).note ?? "") as string; if (v !== cur) run(a.id, () => setAccountNote(a.id, v), "メモを保存しました"); }}
                      style={{ fontFamily: "inherit", fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }} />
                  </label>
                </div>

                {/* 権限・所属（社内・承認済みのみ） */}
                {editable && (a.role === "agent" || a.role === "admin") && (
                  <div style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-ink-2)" }}>🔐 権限・所属</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 10.5 }}>部署：</span>
                      <select defaultValue={a.department ?? ""} disabled={busy} onChange={(e) => run(a.id, () => setAccountDepartment(a.id, e.target.value || null), "部署を変更しました")} style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 11.5 }}>
                        <option value="">部署なし</option>
                        {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <span className="muted" style={{ fontSize: 10.5 }}>役職：</span>
                      <select defaultValue={a.team_role ?? ""} disabled={busy} onChange={(e) => run(a.id, () => setAccountTeamRole(a.id, (e.target.value || null) as any), "役職を変更しました")} style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 11.5 }}>
                        <option value="">役職なし</option>
                        {TEAM_ROLES.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r]}</option>)}
                      </select>
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
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 10.5, marginRight: 2 }}>職能（兼務可）：</span>
                      {FUNCTIONS.map((fn) => { const on = (a.functions ?? []).includes(fn); return (
                        <button key={fn} type="button" disabled={busy} onClick={() => run(a.id, () => setAccountFunctions(a.id, on ? (a.functions ?? []).filter((x) => x !== fn) : [...(a.functions ?? []), fn]), "職能を保存しました")}
                          className="tag" style={{ cursor: "pointer", fontSize: 10.5, border: 0, background: on ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)" }}>{fn}</button>
                      ); })}
                    </div>
                  </div>
                )}

                {/* 承認・面談履歴 */}
                <div style={{ fontSize: 11.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>
                  {a.approved_at ? <div>承認 {fmtDate(a.approved_at)} <span className="muted">by {a.approved_by_name || a.approved_by_email || "—"}</span></div> : <span className="muted">未承認</span>}
                  {(a as any).meeting_done && (a as any).meeting_done_at && <div style={{ color: "#067647" }}>面談済 {fmtDate((a as any).meeting_done_at)} <span className="muted">by {(a as any).meeting_done_by_name || (a as any).meeting_done_by_email || "—"}</span></div>}
                </div>

                {/* メール／面談履歴パネル（LP仮想行以外） */}
                {!lpVirtual && <ApprovalDetailPanel account={a} emails={act?.emails ?? []} meetings={act?.meetings ?? []} />}

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
