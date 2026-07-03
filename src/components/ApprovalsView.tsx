"use client";

// 新規登録（承認）画面。企業 / 人材 / 営業 / 管理者 をタブで切り分け、
// 承認待ちを承認すると、その区分のダッシュボード/ポータルを利用できるようになる。
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Account, Role } from "@/lib/accounts";
import { approveAccount, bulkDeleteAccounts, setAccountStatus, setAccountRole, setAccountMeetingDone, setAccountOwnerAgent, setAccountNote, getAccountActivity, createAgent, resetAccountPassword, backfillAuthForActiveAccounts, setAccountDepartment, setAccountTeamRole, setAccountFunctions, setAccountTimecard, deleteAccount } from "@/app/settings/account-actions";
import { ApprovalDetailPanel } from "./ApprovalDetailPanel";
import { detectSuspicion } from "@/lib/account-suspicion";
import { FUNCTIONS, DEPARTMENTS, TEAM_ROLES, TEAM_ROLE_LABEL } from "@/lib/roles";
import { setMemberKpiRole } from "@/lib/kpi-roles-actions";
import type { KpiRoleKey } from "@/lib/kpi-roles";

type TabKey = "candidate" | "client" | "partner" | "freelance" | "agent" | "backoffice" | "admin";
type GroupKey = "proper" | "partner";

const TAB_META: Record<TabKey, { label: string; role: Role; hint: string }> = {
  // ── プロパー（社内）──
  agent:      { label: "エージェント",   role: "agent",     hint: "社内の営業メンバー。承認すると営業業務（マッチング・提案等）を利用できます。" },
  backoffice: { label: "バックオフィス", role: "agent",     hint: "社内のバックオフィス職（部署=バックオフィス／職能=バックオフィスのみ）。営業業務メニューは非表示。" },
  admin:      { label: "管理者",         role: "admin",     hint: "社内の管理者。全機能にアクセスできます。" },
  // ── ビジネスパートナー（外部・LP流入）──
  candidate:  { label: "エンジニア",       role: "candidate", hint: "enger.jp(LP)から登録した人材。承認すると人材ダッシュボードを利用できます。" },
  client:     { label: "企業",            role: "client",    hint: "LPから登録したエンド企業。承認すると自社ポータル（案件掲載・おすすめ人材・選考）を利用できます。" },
  partner:    { label: "パートナー企業",   role: "partner",   hint: "LPから登録した社外パートナー。自社＋共有でマッチング（他社情報は匿名表示で漏洩防止）。" },
  freelance:  { label: "副業エージェント", role: "freelance", hint: "ag.enger.jp から登録した個人。自分＋共有でマッチング（他社は匿名表示で漏洩防止）。" },
};

// 新規登録一覧（承認待ちオーバービュー）用：区分ごとの表示バッジ。
//   「企業アカウントか個人（フリーランス）アカウントか」を一目で判別できるよう、
//   法人／個人／社内 の性質チップ＋区分名チップの2段構えで表示する。
const KIND_BADGE: Record<TabKey, { label: string; type: "法人" | "個人" | "社内"; fg: string; bg: string; bd: string }> = {
  client:     { label: "企業",              type: "法人", fg: "#0b5cab", bg: "#e7f0fb", bd: "#cfe0f5" },
  partner:    { label: "パートナー企業",     type: "法人", fg: "#7c3aed", bg: "#f3e8ff", bd: "#ddd6fe" },
  freelance:  { label: "副業エージェント",   type: "個人", fg: "#0d9488", bg: "#e6fffa", bd: "#99f6e4" },
  candidate:  { label: "エンジニア（LP人材）", type: "個人", fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" },
  agent:      { label: "営業",              type: "社内", fg: "#0095D9", bg: "#e0f2fe", bd: "#bae6fd" },
  backoffice: { label: "バックオフィス",     type: "社内", fg: "#6b7280", bg: "#f3f4f6", bd: "#e5e7eb" },
  admin:      { label: "管理者",            type: "社内", fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" },
};
const KIND_TYPE_TONE: Record<"法人" | "個人" | "社内", { fg: string; bg: string }> = {
  法人: { fg: "#3730a3", bg: "#eef2ff" },
  個人: { fg: "#065f46", bg: "#ecfdf5" },
  社内: { fg: "#475569", bg: "#f8fafc" },
};

// 2階層タブ：プロパー（社内）／ビジネスパートナー（外部＝LP流入）。
const GROUPS: { key: GroupKey; label: string; sub: string; tabs: TabKey[] }[] = [
  { key: "proper",  label: "プロパー（社内）",         sub: "社内メンバー（営業・バックオフィス・管理者）", tabs: ["agent", "backoffice", "admin"] },
  { key: "partner", label: "ビジネスパートナー（外部）", sub: "LPから登録された社外の人材・企業・パートナー", tabs: ["candidate", "client", "partner", "freelance"] },
];

/** agent ロールのうち「バックオフィス職」を判定（部署=バックオフィス、または職能がバックオフィスのみ）。
 *   新規登録(職能未設定)はエージェント扱い。承認後に部署/職能を設定してバックオフィスへ振り分ける。 */
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

/** 初期表示：承認待ちが最多のタブ（＝対応が必要な場所）を開く。無ければプロパー＞エージェントの承認済み。 */
function computeInitialSelection(accounts: Account[]): { group: GroupKey; tab: TabKey; status: "pending" | "approved" } {
  const pc: Record<TabKey, number> = { candidate: 0, client: 0, partner: 0, freelance: 0, agent: 0, backoffice: 0, admin: 0 };
  for (const a of accounts) if (a.status === "pending") pc[tabOf(a)]++;
  let bestTab: TabKey | null = null, bestN = 0;
  (Object.keys(pc) as TabKey[]).forEach((t) => { if (pc[t] > bestN) { bestN = pc[t]; bestTab = t; } });
  if (bestTab) {
    const g = GROUPS.find((x) => x.tabs.includes(bestTab as TabKey))!.key;
    return { group: g, tab: bestTab, status: "pending" };
  }
  return { group: "proper", tab: "agent", status: "approved" };
}

const STATUS_BADGE: Record<string, { l: string; c: string; bg: string }> = {
  pending: { l: "承認待ち", c: "#b45309", bg: "#fff6e0" },
  active: { l: "有効", c: "#067647", bg: "#e7f7ee" },
  disabled: { l: "無効", c: "#b42318", bg: "#fdecef" },
};

const fmtDate = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function ApprovalsView({ accounts, agents = [] }: { accounts: Account[]; agents?: { email: string | null; name: string | null }[] }) {
  const router = useRouter();
  // 既定は「承認待ちが居るグループ/タブ」を自動で開く（無ければプロパー＞エージェント）。マウント時のみ算出。
  const init = useMemo(() => computeInitialSelection(accounts), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [group, setGroup] = useState<GroupKey>(init.group);
  const [tab, setTab] = useState<TabKey>(init.tab);
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

  // タブ別の承認待ち件数（agent はバックオフィス判定で2タブに振り分け）。
  const pendingCount = useMemo(() => {
    const m: Record<TabKey, number> = { candidate: 0, client: 0, partner: 0, freelance: 0, agent: 0, backoffice: 0, admin: 0 };
    for (const a of accounts) if (a.status === "pending") { const k = tabOf(a); m[k] = (m[k] ?? 0) + 1; }
    return m;
  }, [accounts]);
  // グループ別の承認待ち合計（グループタブのバッジ用）。
  const groupPending = useMemo(() => {
    const m: Record<GroupKey, number> = { proper: 0, partner: 0 };
    for (const g of GROUPS) m[g.key] = g.tabs.reduce((n, t) => n + (pendingCount[t] ?? 0), 0);
    return m;
  }, [pendingCount]);

  const cur = TAB_META[tab];
  // 「プロパー（社内）」では役割サブタブを廃止し、社内メンバー全員を1つのリストで表示。
  //   営業/バックオフィス/管理者は行の「区分」ドロップダウンで都度切替できる（誤区分の救済もそこで完結）。
  //   ビジネスパートナーは外部4区分（企業/パートナー/副業/人材）が性質的に別物なのでタブのまま。
  const isProperFlat = group === "proper";
  // ステータス絞り込み（承認待ち / 承認済み / すべて）。役割タブ内のサブタブ。
  //   既定：そのタブに「承認待ち」があれば承認待ち／無ければ承認済み。
  //   営業・管理者タブは大半が承認済みのため、既定が「承認待ち」固定だと「いなくなった」ように見える事故が起きていた。
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "all">(init.status);
  // 該当グループ/タブのアカウント（プロパー1枚表示時はグループ内の全タブ＝社内全員）。
  const properTabs = GROUPS.find((g) => g.key === "proper")!.tabs;
  const inRole = isProperFlat
    ? accounts.filter((a) => (properTabs as TabKey[]).includes(tabOf(a)))
    : accounts.filter((a) => tabOf(a) === tab);
  const rolePending = inRole.filter((a) => a.status === "pending").length;
  const roleApproved = inRole.filter((a) => a.status !== "pending").length;
  const rows = inRole
    .filter((a) => statusFilter === "all" ? true : statusFilter === "pending" ? a.status === "pending" : a.status !== "pending")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  // 一括選択（タブ切替時はリセット）
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 削除確認モーダル
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // 「+ エージェント追加」フォームの表示
  const [showCreate, setShowCreate] = useState(false);
  // 仮パスワードの表示（作成・再発行直後の1回限り）
  const [cred, setCred] = useState<{ email: string; password: string; note: string } | null>(null);
  // 「ログイン不可を一括修復」結果
  const [backfill, setBackfill] = useState<{ made: { email: string; password?: string }[]; failed: { email: string; error?: string }[] } | null>(null);
  // 仮パスワード発行系の共通ラッパ
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

  // 怪しさ判定（行ごと）。承認待ちかつ怪しい行を上に並べる助けになる。
  const suspicionMap = useMemo(() => {
    const m = new Map<string, ReturnType<typeof detectSuspicion>>();
    for (const a of rows) m.set(a.id, detectSuspicion(a as any));
    return m;
  }, [rows]);
  const suspectCount = useMemo(() => {
    let n = 0; for (const v of suspicionMap.values()) if (v) n++; return n;
  }, [suspicionMap]);

  // 同一メールが複数区分（企業／人材／パートナー／副業／営業／管理者…）に登録されていないかの検知。
  //   eight.shiyou3@gmail.com のように LP人材(profiles) と 企業(app_users) で二重登録が
  //   発生していたケースを救うため、同じメールアドレスで属する区分が複数あれば警告バッジを出す。
  //   ブロックはしない（誤検知でも安全に運用するため）。
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
    // 同一メールで「異なる区分」が2つ以上ある場合のみ警告対象
    const m = new Map<string, { tab: TabKey; label: string; status: string; name: string | null }[]>();
    for (const [em, list] of byEmail) {
      const distinct = new Set(list.map((x) => x.tab));
      if (distinct.size >= 2) m.set(em, list);
    }
    return m;
  }, [accounts]);
  const crossRoleFor = (a: Account) => {
    const em = (a.email ?? "").trim().toLowerCase();
    if (!em) return null;
    const list = crossRoleMap.get(em);
    if (!list) return null;
    // 自分以外の区分だけ抜き出す
    const others = list.filter((x) => x.tab !== tabOf(a));
    return others.length > 0 ? others : null;
  };

  const toggleOne = (id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const visibleIds = rows.map((r) => r.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));
  const toggleAll = () => {
    setSelected((s) => {
      const n = new Set(s);
      if (allChecked) for (const id of visibleIds) n.delete(id);
      else for (const id of visibleIds) n.add(id);
      return n;
    });
  };
  const selectSuspectsOnly = () => {
    const next = new Set<string>();
    for (const a of rows) if (suspicionMap.get(a.id)) next.add(a.id);
    setSelected(next);
  };

  // タブ切替時に選択をリセット＋既定サブタブを自動判定（承認待ちがあれば承認待ち／なければ承認済み）。
  const setTabSafe = (k: TabKey) => {
    setSelected(new Set());
    const pc = pendingCount[k] ?? 0;
    setStatusFilter(pc > 0 ? "pending" : "approved");
    setTab(k);
  };
  // グループ切替：
  //   ・プロパー（社内）はサブタブを廃止し1枚表示。グループ全体の承認待ち件数で初期サブタブを決定。
  //   ・ビジネスパートナー（外部）はサブタブ維持。承認待ちが最多のタブを既定で開く。
  const setGroupSafe = (g: GroupKey) => {
    setGroup(g);
    setSelected(new Set());
    const tabs = GROUPS.find((x) => x.key === g)!.tabs;
    if (g === "proper") {
      // プロパーは tab はダミー（フィルタは isProperFlat 経由でグループ全体を見る）
      const groupPc = tabs.reduce((n, t) => n + (pendingCount[t] ?? 0), 0);
      setStatusFilter(groupPc > 0 ? "pending" : "approved");
      setTab("agent"); // ダミー
      return;
    }
    const withPending = tabs.filter((t) => (pendingCount[t] ?? 0) > 0);
    const next = withPending.length > 0
      ? withPending.reduce((best, t) => ((pendingCount[t] ?? 0) > (pendingCount[best] ?? 0) ? t : best), withPending[0])
      : tabs[0];
    setTabSafe(next);
  };

  const performBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true); setMsg(null);
    // 選択行のメールを添えて送る（LP 仮想行は email から auth.users も連動削除）
    const targets = rows.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, email: r.email ?? null }));
    const res = await bulkDeleteAccounts(targets);
    setBulkBusy(false); setConfirmOpen(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error || "削除に失敗しました" }); return; }
    const errPart = res.errors.length > 0 ? `（失敗 ${res.errors.length} 件：${res.errors.map((e) => e.error).join(" / ")}）` : "";
    setMsg({ ok: res.deleted > 0, text: `削除 ${res.deleted} 件 ${errPart}` });
    setSelected(new Set());
    router.refresh();
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
    // LP仮想エントリ（profile:）の場合は app_users 作成のため email/name も送る
    if ((a.id.startsWith("profile:") || a.id.startsWith("auth:"))) { fd.set("email", a.email); if (a.name) fd.set("name", a.name); }
    run(a.id, () => approveAccount(fd), `${a.name || a.email} を承認しました`);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 管理者向けツールバー（エージェント追加・ログイン不可一括修復）。
          AccountManager に分散していた機能をここへ集約し、ユーザー管理を1画面に統合。 */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

      {/* 新規登録（承認待ち）の一覧オーバービュー。
          タブを行き来しなくても「誰が・どの種別（法人/個人/社内）で登録したか」を1箇所で確認でき、
          その場で承認 or 該当タブへジャンプできる（要望：ユーザー管理がわかりづらい への対応）。 */}
      {(() => {
        const pendings = accounts
          .filter((a) => a.status === "pending")
          .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
        if (pendings.length === 0) return null;
        const jumpTo = (k: TabKey) => {
          const g = GROUPS.find((gr) => gr.tabs.includes(k));
          if (g) setGroup(g.key);
          setTab(k);
          setStatusFilter("pending");
        };
        return (
          <div className="card" style={{ padding: 16, borderColor: "#fde9b0", background: "#fffdf5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, color: "#b45309" }}>notifications_active</span>
              <b style={{ fontSize: 13.5 }}>新規登録（承認待ち）</b>
              <span className="badge hot" style={{ fontSize: 11 }}>{pendings.length}</span>
              <span className="muted" style={{ fontSize: 11.5 }}>登録が新しい順。バッジで「法人／個人／社内」と区分を確認し、その場で承認できます。</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pendings.map((a) => {
                const k = tabOf(a);
                const b = KIND_BADGE[k];
                const t = KIND_TYPE_TONE[b.type];
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", borderRadius: 10, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 99, background: t.bg, color: t.fg, border: "1px solid var(--color-border)", flexShrink: 0 }}>{b.type}</span>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 99, background: b.bg, color: b.fg, border: `1px solid ${b.bd}`, flexShrink: 0 }}>{b.label}</span>
                    <b style={{ fontSize: 12.5 }}>{a.name || "（名前未設定）"}</b>
                    <span className="muted mono" style={{ fontSize: 11 }}>{a.email}</span>
                    {a.company_name && <span className="muted" style={{ fontSize: 11 }}>{a.company_name}</span>}
                    <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto", flexShrink: 0 }}>{fmtDateTime(a.created_at)}</span>
                    <button type="button" className="btn btn-xs" disabled={busyId === a.id || pending} onClick={() => doApprove(a)}
                      title={`${b.label}として承認します`}
                      style={{ background: "#067647", borderColor: "#067647", color: "#fff", flexShrink: 0 }}>
                      {busyId === a.id ? "処理中…" : "承認"}
                    </button>
                    <button type="button" className="btn ghost btn-xs" onClick={() => jumpTo(k)} title="該当タブで詳細（削除・区分変更など）を開く" style={{ flexShrink: 0 }}>詳細へ</button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#b42318" }}>
              失敗 {backfill.failed.length} 件：{backfill.failed.map((f) => f.email).join(", ")}
            </div>
          )}
        </div>
      )}

      {/* 新規エージェント作成フォーム */}
      {showCreate && (
        <form
          action={(fd) => runCred(() => createAgent(fd), String(fd.get("email") ?? ""), "アカウントを作成しました")}
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
            <button type="submit" disabled={pending}
              style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--color-brand-600, #0095D9)", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
              {pending ? "作成中…" : "作成して仮パスワードを発行"}
            </button>
            <span className="muted" style={{ fontSize: 11 }}>仮パスワードは自動生成され、作成後に1回だけ表示されます。</span>
          </div>
        </form>
      )}

      {/* 第1階層：プロパー（社内）／ビジネスパートナー（外部） */}
      <div role="tablist" aria-label="区分" style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 12, alignSelf: "flex-start", flexWrap: "wrap" }}>
        {GROUPS.map((g) => {
          const on = group === g.key;
          const gp = groupPending[g.key] ?? 0;
          return (
            <button key={g.key} type="button" role="tab" aria-selected={on} onClick={() => setGroupSafe(g.key)} title={g.sub}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 9, border: 0, cursor: "pointer", fontFamily: "inherit",
                background: on ? "var(--color-surface)" : "transparent",
                color: on ? "var(--color-brand-700)" : "var(--color-ink-3)",
                boxShadow: on ? "0 1px 3px rgba(15,23,42,0.10)" : "none",
                fontSize: 14, fontWeight: on ? 800 : 600,
              }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>{g.key === "proper" ? "badge" : "handshake"}</span>
              <span>{g.label}</span>
              {gp > 0 && <span className="badge hot" style={{ fontSize: 10, padding: "1px 7px" }}>{gp}</span>}
            </button>
          );
        })}
      </div>
      {/* グループ説明 */}
      <div className="muted" style={{ fontSize: 11.5, marginTop: -4 }}>{GROUPS.find((g) => g.key === group)?.sub}</div>

      {/* 第2階層：グループ内の区分タブ。
          プロパー（社内）はサブタブ廃止＝メンバー一覧を1枚で表示し、区分は行のドロップダウンで切替。 */}
      {!isProperFlat && (
        <div role="tablist" aria-label="役割" style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", flexWrap: "wrap" }}>
          {GROUPS.find((g) => g.key === group)!.tabs.map((tk) => {
            const t = TAB_META[tk];
            const active = tab === tk;
            const pc = pendingCount[tk] ?? 0;
            return (
              <button key={tk} type="button" role="tab" aria-selected={active} onClick={() => setTabSafe(tk)} title={t.hint}
                style={{ padding: "10px 18px", background: "transparent", border: 0, borderBottom: active ? "2px solid var(--color-brand-600)" : "2px solid transparent", color: active ? "var(--color-brand-700)" : "var(--color-ink-3)", fontWeight: active ? 700 : 600, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span>{t.label}</span>
                {pc > 0 && <span className="badge hot" style={{ fontSize: 10, padding: "1px 7px" }}>{pc}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {isProperFlat
            ? "社内メンバー全員を1つのリスト表示。各行のピル（営業／バックオフィス／管理者）をクリックでトグル。営業＋バックオフィスなどの兼務もOKです。"
            : cur.hint}
        </div>
        {/* 同一メールの別区分二重登録の件数バッジ（全体・参考情報）。クリックで該当行のみ選択。 */}
        {(() => {
          const dupRows = rows.filter((r) => crossRoleFor(r));
          if (dupRows.length === 0) return null;
          return (
            <button type="button" onClick={() => setSelected(new Set(dupRows.map((r) => r.id)))}
              title={`同じメールが別区分にも登録されているレコードを選択します`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 99,
                background: "#fff5e6", color: "#9a3412", border: "1px solid #fed7aa", cursor: "pointer", fontFamily: "inherit" }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>group_remove</span>
              別区分にも登録あり {dupRows.length} 件
            </button>
          );
        })()}
        {suspectCount > 0 && (
          <button type="button" onClick={selectSuspectsOnly} title="怪しさを検知した行のみ選択します"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "5px 10px", borderRadius: 99,
              background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf", cursor: "pointer", fontFamily: "inherit" }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>warning</span>
            怪しい登録 {suspectCount} 件（クリックで選択）
          </button>
        )}
      </div>

      {/* 承認待ち / 承認済み のサブタブ（役割タブ内） */}
      <div role="tablist" aria-label="ステータス" style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--color-surface-inset)", borderRadius: 99, alignSelf: "flex-start" }}>
        {([
          { k: "pending",  label: "承認待ち", n: rolePending,  fg: "#b45309", bg: "#fff6e0" },
          { k: "approved", label: "承認済み", n: roleApproved, fg: "#067647", bg: "#e7f7ee" },
          { k: "all",      label: "すべて",   n: rolePending + roleApproved, fg: "var(--color-ink)", bg: "var(--color-surface)" },
        ] as const).map((s) => {
          const on = statusFilter === s.k;
          return (
            <button key={s.k} type="button" role="tab" aria-selected={on}
              onClick={() => { setStatusFilter(s.k); setSelected(new Set()); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: 99, fontFamily: "inherit",
                background: on ? "var(--color-surface)" : "transparent",
                color: on ? s.fg : "var(--color-ink-3)",
                boxShadow: on ? "0 1px 2px rgba(15,23,42,0.08)" : "none",
                fontSize: 12.5, fontWeight: on ? 800 : 600, border: 0, cursor: "pointer",
              }}>
              {s.label}
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 99,
                background: on ? s.bg : "var(--color-surface)", color: on ? s.fg : "var(--color-ink-4)" }}>{s.n}</span>
            </button>
          );
        })}
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? "var(--color-success)" : "var(--color-danger)" }}>{msg.text}</div>}

      {rows.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 30, fontSize: 13 }}>
          {/* フィルタで隠れているだけなら、別フィルタへの導線を出す（"いなくなった"誤解の防止）。 */}
          {statusFilter === "pending" && roleApproved > 0 ? (
            <>承認待ちはありません。
              <button type="button" onClick={() => setStatusFilter("approved")} style={{ marginLeft: 8, fontSize: 12.5, color: "var(--color-brand-700)", background: "transparent", border: 0, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
                承認済み {roleApproved} 件を表示
              </button>
            </>
          ) : statusFilter === "approved" && rolePending > 0 ? (
            <>承認済みはありません。
              <button type="button" onClick={() => setStatusFilter("pending")} style={{ marginLeft: 8, fontSize: 12.5, color: "var(--color-brand-700)", background: "transparent", border: 0, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
                承認待ち {rolePending} 件を表示
              </button>
            </>
          ) : (
            <>{cur.label}の登録はまだありません。</>
          )}
        </div>
      ) : (
        <div className="card flush">
          <div className="tbl-scroll" style={{ overflowX: "auto" }}>
            <table className="tbl tbl-compact" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: "center" }}>
                    <input type="checkbox" aria-label="表示行をすべて選択"
                      checked={allChecked} ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                      onChange={toggleAll} style={{ accentColor: "var(--color-brand-600)" }} />
                  </th>
                  <th>状態</th><th>名前 / 会社</th><th>メール</th><th>申請日時</th><th style={{ width: 140 }}>担当エージェント</th><th style={{ width: 200 }}>メモ（根拠/連絡）</th><th style={{ width: 220 }}>承認・面談履歴</th><th style={{ width: 260 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((a) => {
                  const sb = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
                  const busy = busyId === a.id && pending;
                  const sus = suspicionMap.get(a.id) ?? null;
                  const cross = crossRoleFor(a);
                  const checked = selected.has(a.id);
                  const mainRow = (
                    <tr key={a.id} style={sus ? { background: sus.level === "danger" ? "rgba(180,35,24,.05)" : "rgba(217,119,6,.04)" } : undefined}>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" aria-label={`${a.name ?? a.email} を選択`}
                          checked={checked} onChange={() => toggleOne(a.id)}
                          style={{ accentColor: "var(--color-brand-600)" }} />
                      </td>
                      <td><span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, color: sb.c, background: sb.bg }}>{sb.l}</span></td>
                      <td>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name || "（名前未設定）"}</span>
                          {sus && (
                            <span title={sus.reasons.join(" / ")} style={{
                              display: "inline-flex", alignItems: "center", gap: 3,
                              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                              color: sus.level === "danger" ? "#b42318" : "#92400e",
                              background: sus.level === "danger" ? "#fdecef" : "#fff6e0",
                              border: `1px solid ${sus.level === "danger" ? "#f7c5cf" : "#fde9b0"}`,
                            }}>
                              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>warning</span>
                              {sus.level === "danger" ? "スパム疑い" : "要確認"}
                            </span>
                          )}
                          {/* 同じメールが別区分にも登録されている場合の警告（ブロックはしない）。 */}
                          {cross && (
                            <span title={`同じメールが別区分にも登録されています：\n${cross.map((x) => `・${x.label}（${STATUS_BADGE[x.status]?.l ?? x.status}）${x.name ? ` ${x.name}` : ""}`).join("\n")}`}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 3,
                                fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                                color: "#9a3412", background: "#fff5e6", border: "1px solid #fed7aa",
                              }}>
                              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>group_remove</span>
                              別区分にも登録あり（{cross.map((x) => x.label).join("／")}）
                            </span>
                          )}
                        </div>
                        {a.company_name && <div className="muted" style={{ fontSize: 11 }}>{a.company_name}</div>}
                        {sus && (
                          <div style={{ fontSize: 10, color: sus.level === "danger" ? "#b42318" : "#92400e", marginTop: 2, lineHeight: 1.4 }}>
                            {sus.reasons.join(" / ")}
                          </div>
                        )}
                        {cross && (
                          <div style={{ fontSize: 10, color: "#9a3412", marginTop: 2, lineHeight: 1.4 }}>
                            同一メールの別登録：{cross.map((x) => `${x.label}（${STATUS_BADGE[x.status]?.l ?? x.status}${x.name ? ` ${x.name}` : ""}）`).join(" / ")}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{a.email}</td>
                      <td style={{ fontSize: 11.5, color: "var(--color-ink-3)" }} title={a.created_at}>
                        {fmtDateTime(a.created_at)}
                        {(a.id.startsWith("profile:") || a.id.startsWith("auth:")) && (() => {
                          const ss = (a as any).signup_source as string | null | undefined;
                          // dojo=橙、enger=青、不明=グレー。labelは登録元LPに対応させる
                          const map: Record<string, { label: string; color: string }> = {
                            dojo:  { label: "LP登録（無限道場）", color: "#d97706" },
                            enger: { label: "LP登録（enger.jp）", color: "#0095D9" },
                          };
                          const m = ss && map[ss] ? map[ss] : { label: "LP登録（不明）", color: "var(--color-ink-4)" };
                          return <div style={{ fontSize: 9.5, color: m.color, fontWeight: 700, marginTop: 2 }} title={ss ? `signup_source=${ss}` : "signup_source未設定／メールドメインでも判定不可"}>{m.label}</div>;
                        })()}
                      </td>
                      <td>
                        <select disabled={busy || a.status === "pending" || (a.id.startsWith("profile:") || a.id.startsWith("auth:"))} defaultValue={(a as any).owner_agent_email ?? ""}
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
                        <input type="text" defaultValue={(a as any).note ?? ""} disabled={busy || a.status === "pending" || (a.id.startsWith("profile:") || a.id.startsWith("auth:"))}
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
                          {/* 区分の付け替え（誤って別区分で登録された場合の救済）。
                              プロパー（社内）はクリックで「営業／バックオフィス／管理者」を独立にトグル可能にする
                              （営業＋バックオフィスの兼務など複数併用OK）。
                              　・営業/バックオフィス … 職能(functions) に該当を追加/除外
                              　・管理者              … role を admin と agent でトグル
                              　※ 営業/バックオフィスは role に依らない（管理者でも兼務可）。
                              ビジネスパートナー（外部）は従来どおりセレクト1択。 */}
                          {isProperFlat ? (() => {
                            const fns = a.functions ?? [];
                            const isAdmin = a.role === "admin";
                            const isSales = fns.includes("営業");
                            const isBo = fns.includes("バックオフィス");
                            const toggleFunction = (fn: "営業" | "バックオフィス") => {
                              const next = fns.includes(fn) ? fns.filter((x) => x !== fn) : [...fns, fn];
                              run(a.id, async () => {
                                // ロールが agent 以外（admin等）でも職能は記録可。営業/バックオフィスを使う場合は実体として agent 寄りだが、
                                // 管理者として残したい場合もあるためロール変更はしない（管理者トグルで明示）。
                                return setAccountFunctions(a.id, next);
                              }, `${fn}を${fns.includes(fn) ? "解除" : "付与"}しました`);
                            };
                            const toggleAdmin = () => {
                              run(a.id, async () => setAccountRole(a.id, isAdmin ? "agent" as any : "admin" as any), `${isAdmin ? "管理者を解除" : "管理者にしました"}`);
                            };
                            const pillBase: React.CSSProperties = { padding: "3px 9px", borderRadius: 99, fontSize: 11, fontFamily: "inherit", cursor: "pointer", fontWeight: 700, border: "1px solid" };
                            const pillOn: React.CSSProperties = { background: "var(--color-brand-600)", color: "#fff", borderColor: "var(--color-brand-600)" };
                            const pillOff: React.CSSProperties = { background: "var(--color-surface-inset)", color: "var(--color-ink-3)", borderColor: "var(--color-border)" };
                            const lpVirtual = a.id.startsWith("profile:") || a.id.startsWith("auth:");
                            const dis = busy || a.status === "pending" || lpVirtual;
                            return (
                              <span title="クリックで権限を個別にトグル（営業＋バックオフィスの兼務OK）" style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                                <button type="button" disabled={dis} onClick={() => toggleFunction("営業")} style={{ ...pillBase, ...(isSales ? pillOn : pillOff) }}>営業</button>
                                <button type="button" disabled={dis} onClick={() => toggleFunction("バックオフィス")} style={{ ...pillBase, ...(isBo ? pillOn : pillOff) }}>バックオフィス</button>
                                <button type="button" disabled={dis} onClick={toggleAdmin} style={{ ...pillBase, ...(isAdmin ? { background: "#b45309", color: "#fff", borderColor: "#b45309" } : pillOff) }}>管理者</button>
                              </span>
                            );
                          })() : (
                            <select defaultValue={a.role} disabled={busy || a.status === "pending" || (a.id.startsWith("profile:") || a.id.startsWith("auth:"))}
                              onChange={(e) => { const r = e.target.value as Role; run(a.id, () => setAccountRole(a.id, r as any), "区分を変更しました"); }}
                              style={{ fontFamily: "inherit", fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)" }}>
                              <option value="client">企業</option>
                              <option value="partner">パートナー企業</option>
                              <option value="freelance">副業エージェント</option>
                              <option value="candidate">人材</option>
                              <option value="agent">営業</option>
                              <option value="admin">管理者</option>
                            </select>
                          )}
                          {/* 詳細（権限編集／メール送信／面談予定）。LP仮想行は履歴・メール部分は使えないが、開けるようにして承認待ちガイドを見せる */}
                          {!(a.id.startsWith("profile:") || a.id.startsWith("auth:")) && (
                            <button type="button" className="btn ghost btn-xs" onClick={() => toggleExpand(a.id)} title="権限編集／メール送信／面談予定を開く">
                              {expanded === a.id ? "閉じる" : "🔐 詳細・権限"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                  const expandedRow = expanded === a.id ? (
                    <tr key={`${a.id}-x`}>
                      <td colSpan={9} style={{ background: "var(--color-surface-soft)", padding: 12 }}>
                        {/* 権限編集（部署・役職・職能・タイムカード・PW再発行・削除）— 承認済みかつ agent/admin のみ。
                            承認待ちはここを表示せず、権限が付与されていないことを明示する。 */}
                        {a.status !== "pending" && (a.role === "agent" || a.role === "admin") && (
                          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--color-ink-2)" }}>🔐 権限・所属（{a.email}）</div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              <span className="muted" style={{ fontSize: 10.5 }}>部署：</span>
                              <select defaultValue={a.department ?? ""} disabled={busy}
                                onChange={(e) => run(a.id, () => setAccountDepartment(a.id, e.target.value || null), "部署を変更しました")}
                                style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 11.5 }}>
                                <option value="">部署なし</option>
                                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                              </select>
                              <span className="muted" style={{ fontSize: 10.5 }}>役職：</span>
                              <select defaultValue={a.team_role ?? ""} disabled={busy}
                                onChange={(e) => run(a.id, () => setAccountTeamRole(a.id, (e.target.value || null) as any), "役職を変更しました")}
                                style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 11.5 }}>
                                <option value="">役職なし</option>
                                {TEAM_ROLES.map((r) => <option key={r} value={r}>{TEAM_ROLE_LABEL[r]}</option>)}
                              </select>
                              {/* KPI/KGI のチーム振り分け（アウトサイド/インサイド）。kpi_role に保存し、
                                  KPI推移のファネル・ボードがこの区分で集計される。 */}
                              <span className="muted" style={{ fontSize: 10.5 }}>KPIチーム：</span>
                              {/* 表示初期値は実効値（kpi_role 未設定なら position を流用）。ファネルの集計と一致させる。
                                  ※ defaultValue は初期表示のみ。実書込みは onChange（実際に選択を変えた時）だけ。 */}
                              <select defaultValue={(a.kpi_role ?? a.position) ?? ""} disabled={busy}
                                title="KPI/KGI のチーム（アウトサイド/インサイド）。KPI推移がこの区分で集計されます。"
                                onChange={(e) => run(a.id, () => setMemberKpiRole(a.email, e.target.value as KpiRoleKey | ""), "KPIチームを変更しました")}
                                style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 11.5 }}>
                                <option value="">未設定</option>
                                <option value="outside">アウトサイド</option>
                                <option value="inside">インサイド</option>
                                {a.kpi_role === "telapo" && <option value="telapo">テレアポ</option>}
                              </select>
                              <label title="バイト/副業向けのタイムカード（本人打刻）を有効化" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--color-ink-3)", cursor: "pointer" }}>
                                <input type="checkbox" defaultChecked={!!(a as any).is_timecard_user} disabled={busy}
                                  onChange={(e) => run(a.id, () => setAccountTimecard(a.id, e.target.checked), "タイムカード設定を保存しました")} />
                                タイムカード
                              </label>
                            </div>
                            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                              <span className="muted" style={{ fontSize: 10.5, marginRight: 2 }}>職能（兼務可）：</span>
                              {FUNCTIONS.map((fn) => { const on = (a.functions ?? []).includes(fn); return (
                                <button key={fn} type="button" disabled={busy}
                                  onClick={() => run(a.id, () => setAccountFunctions(a.id, on ? (a.functions ?? []).filter((x) => x !== fn) : [...(a.functions ?? []), fn]), "職能を保存しました")}
                                  className="tag" style={{ cursor: "pointer", fontSize: 10.5, border: 0, background: on ? "var(--color-brand-600)" : "var(--color-surface-inset)", color: on ? "#fff" : "var(--color-ink-3)" }}>{fn}</button>
                              ); })}
                            </div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                              <button type="button" disabled={busy}
                                onClick={() => { if (confirm(`${a.email} のパスワードを再発行しますか？新しい仮パスワードが表示され、現在のパスワードは無効になります。`)) runCred(() => resetAccountPassword(a.email), a.email, "パスワードを再発行しました"); }}
                                title="パスワード再発行"
                                style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#0b5cab" }}>
                                🔑 PW再発行
                              </button>
                              <button type="button" disabled={busy}
                                onClick={() => { if (confirm(`${a.email} を削除しますか？`)) run(a.id, () => deleteAccount(a.id), "削除しました"); }}
                                title="アカウント削除"
                                style={{ padding: "6px 11px", borderRadius: 8, border: "1px solid var(--color-border)", background: "#fff", fontSize: 12, cursor: "pointer", color: "#b42318" }}>
                                × 削除
                              </button>
                            </div>
                          </div>
                        )}
                        {/* 承認待ち向けの注意：権限はまだ何も付与されていない */}
                        {a.status === "pending" && (
                          <div style={{ background: "#fff6e0", border: "1px solid #fde9b0", borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#9a7b12" }}>
                            ⏳ このアカウントは <b>承認待ち</b> です。区分・担当・メモ・権限の編集は<b>承認後</b>に有効化されます。
                          </div>
                        )}
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

      {/* 一括操作バー（画面下部に固定）。1件以上選択されたら出現。 */}
      {selected.size > 0 && (
        <div role="region" aria-label="一括操作"
          style={{
            position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 50,
            marginTop: 6,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            padding: "12px 16px", borderRadius: 12,
            background: "var(--color-surface)", border: "1px solid var(--color-border-strong)",
            boxShadow: "0 -8px 24px rgba(15,23,42,.12)",
          }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1, color: "var(--color-brand-600)" }}>check_box</span>
            {selected.size} 件選択中
          </span>
          <button type="button" className="btn ghost btn-xs" onClick={() => setSelected(new Set())} disabled={bulkBusy}>選択を解除</button>
          <span style={{ flex: 1 }} />
          <button type="button"
            disabled={bulkBusy}
            onClick={() => setConfirmOpen(true)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 18px", borderRadius: 10, border: 0,
              background: "var(--color-danger, #b42318)", color: "#fff",
              fontWeight: 800, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
              boxShadow: "0 6px 14px rgba(180,35,24,.25)",
            }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>delete</span>
            選択した {selected.size} 件を削除
          </button>
        </div>
      )}

      {/* 削除確認モーダル（破壊的操作） */}
      {confirmOpen && (
        <div onClick={() => !bulkBusy && setConfirmOpen(false)}
          role="dialog" aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", display: "grid", placeItems: "center", zIndex: 600, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card"
            style={{ width: "100%", maxWidth: 480, padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 28, color: "var(--color-danger, #b42318)" }}>warning</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{selected.size} 件のアカウントを削除します</h3>
            </div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.7 }}>
              この操作は取り消せません。<b>app_users / public.profiles / Supabase Auth</b> のうち該当する行を可能な範囲で連動削除します。
              本人がログイン中の場合はセッションが切れます。承認待ち以外の行も削除されます。続行しますか？
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn ghost btn-xs" onClick={() => setConfirmOpen(false)} disabled={bulkBusy}>キャンセル</button>
              <button type="button" onClick={performBulkDelete} disabled={bulkBusy}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "9px 16px", borderRadius: 10, border: 0,
                  background: "var(--color-danger, #b42318)", color: "#fff",
                  fontWeight: 800, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
                }}>
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>delete</span>
                {bulkBusy ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
