"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/AppLink";
import { freelanceShortId, hasJapanese, skillTagLabel, type Engineer, type EngineerAction, type EngineerSource, type Scout, type Application, type JobFavorite, type SkillSheet } from "@/lib/engineers";
import type { EngineerChatStatus, EngineerProfileName } from "@/lib/chat";
import { addEngineerAction, deleteEngineerAction, sendScout, setEngineerMeetingDone, bulkDeleteEngineers, bulkSetLoginSuspension, markEngineerWithdrawn, unmarkEngineerWithdrawn, openScoutThread, lookupJobByNo, prepareCandidateFromFreelancer, registerCandidateFromFreelancer, type FreelancePrefill } from "@/app/engineers/actions";
import { toast } from "@/components/toast";
import { Icons } from "./icons";

// ---------- 一覧表示用ヘルパ（人材一覧 EntityTable と同じ rule） ----------
const FRESH_OPTIONS = [
  { value: "新着", label: "新着" },
  { value: "3日以内", label: "3日以内" },
  { value: "4〜14日前", label: "4〜14日前" },
  { value: "それ以前", label: "それ以前" },
];
function freshnessLabel(d: string | null): string {
  if (!d) return "それ以前";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "それ以前";
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  if (days <= 0) return "新着";
  if (days <= 3) return "3日以内";
  if (days <= 14) return "4〜14日前";
  return "それ以前";
}
function Fresh({ d }: { d: string | null }) {
  const label = freshnessLabel(d);
  const tone = label === "新着" ? "new" : label === "3日以内" ? "soon" : label === "4〜14日前" ? "mid" : "old";
  return <span className="fresh" data-tone={tone}><span className="dot" />{label}</span>;
}
const shortId = freelanceShortId; // 人材ID（E-C94D4）は lib/engineers を唯一の生成元にする

// 一覧・モーダルの表示名（チャット新規スレッドと同じフォールバック）：
//   漢字氏名（プロフィール登録の姓名・日本語のみ）→ 人材ID（E-C94D4）。
//   アカウントID（display_name / github_login）には倒さない（＝アカウントID露出を防ぐ）。
const resolveDisplayName = (e: Engineer, prof?: EngineerProfileName): string => {
  const kanji = (prof?.kanji ?? "").trim();
  return (hasJapanese(kanji) ? kanji : "") || shortId(e.id) || "—";
};
// アバター用の2文字（イニシャル登録→漢字氏名→表示名 の順）。
const avatarTextOf = (name: string, prof?: EngineerProfileName): string => {
  const ini = (prof?.initials ?? "").trim();
  const kanji = (prof?.kanji ?? "").trim();
  return (ini || (hasJapanese(kanji) ? kanji : name)).slice(0, 2);
};

/** 登録元バッジ。EngineerSource (key/label/method/color) を表示。将来のLP/方式追加に備え汎用化。 */
const PALETTE: Record<EngineerSource["color"], { bg: string; fg: string; bd: string }> = {
  warn:    { bg: "#fff6e0", fg: "#9a7b12", bd: "#fde9b0" },
  brand:   { bg: "var(--color-brand-50)", fg: "var(--color-brand-700,#0b5cab)", bd: "var(--color-brand-100,#cfe1f7)" },
  accent:  { bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc" },
  danger:  { bg: "#fdecef", fg: "#d23f57", bd: "#f7c5cf" },
  neutral: { bg: "var(--color-surface-inset)", fg: "var(--color-ink-3)", bd: "var(--color-border)" },
};
function SourceBadge({ source }: { source: EngineerSource }) {
  const p = PALETTE[source.color] ?? PALETTE.neutral;
  return (
    <span
      title={`登録元: ${source.label}${source.method ? ` / ${source.method}` : ""}`}
      style={{
        display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: 99,
        fontSize: 10, fontWeight: 700, letterSpacing: ".02em", whiteSpace: "nowrap", gap: 4,
        background: p.bg, color: p.fg, border: `1px solid ${p.bd}`,
      }}
    >
      <span>{source.label}</span>
      {source.method && <span style={{ opacity: .8, fontWeight: 600 }}>· {source.method}</span>}
    </span>
  );
}

const pay = (e: Engineer) => {
  const lo = e.estimated_pay_low, hi = e.estimated_pay_high, mid = e.estimated_pay_mid;
  if (lo && hi) return `¥${lo}〜${hi}万`;
  if (mid) return `¥${mid}万`;
  return "—";
};
const skillNames = (e: Engineer) => (e.skills ?? []).map((s) => s.name).filter(Boolean);

// #306④：タグ群を最大2段（約2行）まで表示し、あふれる場合は「＋全て見る」で全表示にする。
//   折りたたみ時の高さ(COLLAPSED_H)を超えるときだけトグルを出す（scrollHeight で判定）。
const TAGCLOUD_COLLAPSED_H = 54; // .tag ≈ 23px × 2段 ＋ 行間
function TagCloud({ items, tagClass = "tag", emptyText = "—" }: { items: string[]; tagClass?: string; emptyText?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflow(el.scrollHeight > TAGCLOUD_COLLAPSED_H + 2);
  }, [items]);
  if (!items || items.length === 0) return <span className="muted" style={{ fontSize: 12 }}>{emptyText}</span>;
  return (
    <div>
      <div ref={ref} style={{ display: "flex", gap: 5, flexWrap: "wrap", maxHeight: expanded ? undefined : TAGCLOUD_COLLAPSED_H, overflow: "hidden" }}>
        {items.map((s, i) => <span key={i} className={tagClass} style={{ fontSize: 11 }}>{s}</span>)}
      </div>
      {overflow && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          style={{ marginTop: 5, fontSize: 11, fontWeight: 700, color: "var(--color-brand-700)", background: "transparent", border: 0, padding: 0, cursor: "pointer" }}>
          {expanded ? "閉じる" : `＋全て見る（${items.length}）`}
        </button>
      )}
    </div>
  );
}

// タップ選択中心の対応種別（営業の入力を最小化）
// ※「面談設定」「見送り」「保留」は選択肢から除外（過去データの表示は ACTION_COLOR/ICON で維持）。
const ACTION_TYPES = ["スカウト送信", "メール送信", "返信あり", "面談実施", "メモ"];
const ACTION_COLOR: Record<string, string> = {
  "スカウト送信": "#0b5cab", "チャット開始": "#7c3aed", "メール送信": "#0b5cab", "返信あり": "#067647", "面談設定": "#067647",
  "面談実施": "#067647", "面談済": "#067647", "見送り": "#b42318", "保留": "#b45309", "メモ": "#475467",
};
// 対応履歴の先頭に出すアイコン（スカウト送信／チャット開始 を視覚的に区別する・④）。
const ACTION_ICON: Record<string, string> = { "スカウト送信": "campaign", "チャット開始": "chat" };
const fmtDate = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
// 登録日時（年月日＋時刻）
const fmtDateTime = (s?: string | null) => { if (!s) return "—"; const d = new Date(s); return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
// 連絡先の有無アイコン群（メール・電話・チャット）。
//   チャットは ENGERフリーランスからのメッセージに気づけるよう、未読=色＋ドット / 未返信=色のみ で表示し、
//   クリックでチャット画面(/chat?t=...)を開いて確認・返信できる。
function ContactIcons({ e, chat }: { e: { email?: string | null; phone?: string | null; contact_line?: string | null }; chat?: EngineerChatStatus }) {
  const items: { ic: string; label: string; on: boolean; href?: string }[] = [
    { ic: "mail", label: e.email || "メールなし", on: !!e.email, href: e.email ? `mailto:${e.email}` : undefined },
    { ic: "call", label: e.phone || "電話なし", on: !!e.phone, href: e.phone ? `tel:${e.phone}` : undefined },
  ];
  const unread = chat?.unread ?? 0;
  const unreplied = !!chat?.unreplied;
  // 未読=赤 / 未返信=アンバー / それ以外はメッセージ連絡先の有無で青or淡色。
  const chatColor = unread > 0 ? "#dc2626" : unreplied ? "#e0a317" : (e.contact_line ? "#0b5cab" : "var(--color-ink-5)");
  const chatActive = unread > 0 || unreplied || !!e.contact_line || !!chat?.threadId;
  const chatTitle = unread > 0 ? `未読チャット ${unread}件（クリックで開く）`
    : unreplied ? "未返信のチャットあり（クリックで確認・返信）"
    : chat?.threadId ? "チャットを開く"
    : (e.contact_line || "メッセージなし");
  const chatIcon = (
    <span style={{ position: "relative", display: "inline-flex", lineHeight: 0 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 17, color: chatColor, opacity: chatActive ? 1 : 0.4 }}>chat</span>
      {unread > 0 && <span aria-hidden style={{ position: "absolute", top: -2, right: -2, width: 7, height: 7, borderRadius: 99, background: "#dc2626", border: "1.5px solid var(--color-surface)" }} />}
    </span>
  );
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {items.map((it, i) => it.on ? (
        it.href
          ? <a key={i} href={it.href} title={it.label} onClick={(ev) => ev.stopPropagation()} className="material-symbols-outlined" style={{ fontSize: 17, color: "#0b5cab", textDecoration: "none" }}>{it.ic}</a>
          : <span key={i} title={it.label} className="material-symbols-outlined" style={{ fontSize: 17, color: "#0b5cab" }}>{it.ic}</span>
      ) : (
        <span key={i} title={it.label} className="material-symbols-outlined" style={{ fontSize: 17, color: "var(--color-ink-5)", opacity: .4 }}>{it.ic}</span>
      ))}
      {chat?.threadId
        ? <Link href={`/chat?t=${chat.threadId}`} title={chatTitle} onClick={(ev) => ev.stopPropagation()} style={{ textDecoration: "none", display: "inline-flex" }}>{chatIcon}</Link>
        : <span title={chatTitle}>{chatIcon}</span>}
    </span>
  );
}

// スキルシートのファイルマーク。拡張子で色を出し分け（pdf=赤 / xls=緑 / doc=青 / 既定=ブランド）。
const sheetColor = (s: SkillSheet): string => {
  const ext = (s.name || s.url || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/)?.[1] ?? "";
  if (ext === "pdf") return "#d23f57";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "#067647";
  if (ext === "doc" || ext === "docx") return "#0b5cab";
  return "var(--color-brand-700,#0b5cab)";
};
const sheetIcon = (s: SkillSheet): string => {
  const ext = (s.name || s.url || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/)?.[1] ?? "";
  if (ext === "pdf") return "picture_as_pdf";
  if (ext === "xls" || ext === "xlsx" || ext === "csv") return "table_view";
  return "description";
};

/** フリーランス一覧「スキルシート」列：アップロード件数ぶんファイルマークを点灯（最大3）。
 *  各マークをクリックで該当ファイルを新規タブで開く（即閲覧）。ホバーでファイル名を表示。 */
function SkillSheetMarks({ sheets }: { sheets: SkillSheet[] | null | undefined }) {
  const list = (Array.isArray(sheets) ? sheets : []).filter((s) => s && s.url).slice(0, 3);
  if (list.length === 0) return <span className="muted" title="未提出" style={{ fontSize: 12 }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {list.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}
          title={s.name || `スキルシート${i + 1}`}
          className="material-symbols-outlined"
          style={{ fontSize: 18, lineHeight: 1, color: sheetColor(s), textDecoration: "none" }}>
          {sheetIcon(s)}
        </a>
      ))}
      <span className="muted" style={{ fontSize: 10, marginLeft: 2 }}>{list.length}/3</span>
    </span>
  );
}

export function EngineersClient({ engineers, actions = {}, scouts = {}, applications = {}, favorites = {}, profileNames = {}, chatStatus = {}, initialQ = "", candidateNos = {} }: { engineers: Engineer[]; actions?: Record<string, EngineerAction[]>; scouts?: Record<string, Scout[]>; applications?: Record<string, Application[]>; favorites?: Record<string, JobFavorite[]>; profileNames?: Record<string, EngineerProfileName>; chatStatus?: Record<string, EngineerChatStatus>; initialQ?: string; candidateNos?: Record<string, number> }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ); // #255：検索結果からの遷移で ?q= を初期反映
  // お気に入り案件一覧モーダル（履歴列のハートをクリックで開く）。
  const [favDetail, setFavDetail] = useState<Engineer | null>(null);
  // 履歴列の「応募」「スカ」クリックで開く案件名一覧モーダル。
  const [histDetail, setHistDetail] = useState<{ engineer: Engineer; kind: "応募" | "スカ" } | null>(null);
  // withdrawal: "" (退会済みを除く＝既定) / "wish" (退会希望のみ) / "done" (退会処理済みのみ) / "all" (すべて表示)
  // meeting: "" (すべて) / "done" (面談済のみ)
  const [filters, setFilters] = useState<{ status: string; lang: string; sheet: string; withdrawal: string; meeting: string }>({ status: "", lang: "", sheet: "", withdrawal: "", meeting: "" });
  const [detail, setDetail] = useState<Engineer | null>(null);
  const [matchingMsg, setMatchingMsg] = useState<string | null>(null);
  // 一括削除用の選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // 面談済：対応履歴(engineer_actions)に action="面談済" があれば面談済とみなす。
  //   チェックで記録(insert)／解除(delete)。楽観的に即時反映し、失敗時のみ元に戻す。
  const [meetingDoneIds, setMeetingDoneIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [id, list] of Object.entries(actions)) if ((list ?? []).some((a) => a.action === "面談済")) s.add(id);
    return s;
  });
  const [meetingBusy, setMeetingBusy] = useState<string | null>(null);
  const toggleMeetingDone = (e: Engineer) => {
    const next = !meetingDoneIds.has(e.id);
    setMeetingBusy(e.id); setMatchingMsg(null);
    setMeetingDoneIds((s) => { const n = new Set(s); if (next) n.add(e.id); else n.delete(e.id); return n; });
    setEngineerMeetingDone({ engineer_id: e.id, engineer_name: e.display_name || e.github_login || e.name, done: next }).then((res) => {
      setMeetingBusy(null);
      if (!res.ok) {
        setMeetingDoneIds((s) => { const n = new Set(s); if (next) n.delete(e.id); else n.add(e.id); return n; });
        setMatchingMsg(res.error || "面談済の更新に失敗しました");
      }
    });
  };

  // フィルタ選択肢（データから動的生成）
  const langOptions = useMemo(() => Array.from(new Set(engineers.map((e) => e.primary_language).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "ja")), [engineers]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return engineers.filter((e) => {
      if (needle) {
        const prof = profileNames[e.id];
        // 漢字氏名・フリガナ・イニシャル・人材ID(E-XXXXX) でも検索できるようにする。
        const hay = [e.display_name, e.github_login, e.name, prof?.kanji, prof?.kana, prof?.initials, shortId(e.id), e.primary_language, e.email, e.phone, e.contact_line, ...skillNames(e), ...(e.tools ?? [])].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (filters.status && freshnessLabel(e.created_at) !== filters.status) return false;
      if (filters.lang && (e.primary_language || "") !== filters.lang) return false;
      if (filters.meeting === "done" && !meetingDoneIds.has(e.id)) return false;
      const hasSheets = (e.skill_sheets?.length ?? 0) > 0 || !!e.skill_sheet_url;
      if (filters.sheet === "あり" && !hasSheets) return false;
      if (filters.sheet === "なし" && hasSheets) return false;
      // 退会フィルタ：
      //   既定（""）  → 退会処理済みは除外、それ以外（通常 + 退会希望中）を表示
      //   "wish"      → 退会希望中（申請あり・処理未済）のみ
      //   "done"      → 退会処理済みのみ
      //   "all"       → すべて表示
      const wd = filters.withdrawal;
      const isReq = !!e.withdrawal_requested_at;
      const isDone = !!e.withdrawal_completed_at;
      if (wd === "" && isDone) return false;
      if (wd === "wish" && !(isReq && !isDone)) return false;
      if (wd === "done" && !isDone) return false;
      return true;
    });
  }, [q, filters, engineers, meetingDoneIds]);

  // #275④ 日時ソート（登録日時／最終ログイン日時）。クリックで昇順/降順を切替。
  const [sortKey, setSortKey] = useState<"created" | "login">("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: "created" | "login") => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sorted = useMemo(() => {
    const ts = (v: string | null | undefined) => { const t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? null : t; };
    return [...filtered].sort((a, b) => {
      const ta = ts(sortKey === "created" ? a.created_at : a.last_login_at);
      const tb = ts(sortKey === "created" ? b.created_at : b.last_login_at);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1; // 未ログイン（—）は昇順/降順に関わらず末尾へ
      if (tb == null) return -1;
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
  }, [filtered, sortKey, sortDir]);

  // ページング
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, filters, pageSize]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
  // 表示中（このページ）の全選択トグル
  const visibleIds = pageRows.map((e) => e.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = visibleIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allChecked) for (const id of visibleIds) n.delete(id);
    else for (const id of visibleIds) n.add(id);
    return n;
  });
  const performBulkDelete = () => {
    if (selected.size === 0) return;
    setBulkBusy(true); setMatchingMsg(null);
    const ids = [...selected];
    bulkDeleteEngineers(ids).then((res) => {
      setBulkBusy(false); setConfirmDel(false);
      if (!res.ok) { setMatchingMsg(res.error || "削除に失敗しました"); return; }
      setSelected(new Set());
      // #277：認証（Auth）側のクリーンアップ結果も表示（再登録可否の確認材料）。
      const authNote = (res.authErrors ?? 0) > 0 ? `（認証削除 ${res.authDeleted ?? 0}件・失敗${res.authErrors}件）` : "";
      setMatchingMsg(`✓ ${res.deleted ?? ids.length} 名を削除しました（再登録可能）${authNote}`);
      router.refresh();
    });
  };
  // #263 ログイン停止/解除（一括）。選択行の状態から実行可能な件数を出し分ける。
  const [confirmSuspend, setConfirmSuspend] = useState<null | "suspend" | "unsuspend">(null);
  const selectedRows = useMemo(() => engineers.filter((e) => selected.has(e.id)), [engineers, selected]);
  const nSuspendable = selectedRows.filter((e) => !e.login_suspended_at).length;
  const nUnsuspendable = selectedRows.filter((e) => !!e.login_suspended_at).length;
  const performSuspension = (suspend: boolean) => {
    // 停止は「未停止の選択者」、解除は「停止中の選択者」のみを対象にする。
    const ids = selectedRows.filter((e) => suspend ? !e.login_suspended_at : !!e.login_suspended_at).map((e) => e.id);
    if (ids.length === 0) return;
    setBulkBusy(true); setMatchingMsg(null);
    bulkSetLoginSuspension(ids, suspend).then((res) => {
      setBulkBusy(false); setConfirmSuspend(null);
      if (!res.ok) { setMatchingMsg(res.error || "更新に失敗しました"); return; }
      setSelected(new Set());
      const kick = suspend ? `（Auth停止 ${res.banned ?? 0}名${(res.banErrors ?? 0) > 0 ? `・失敗${res.banErrors}名` : ""}）` : "";
      setMatchingMsg(suspend
        ? `⛔ ${res.updated ?? ids.length} 名のログインを停止しました${kick}`
        : `✓ ${res.updated ?? ids.length} 名のログイン制限を解除しました`);
      router.refresh();
    });
  };
  const buildPages = (cur1: number, count: number) => {
    const win = [1, 2, cur1 - 1, cur1, cur1 + 1, count - 1, count].filter((n) => n >= 1 && n <= count);
    const uniq = [...new Set(win)].sort((a, b) => a - b);
    const out: (number | "…")[] = []; let prev = 0;
    for (const n of uniq) { if (n - prev > 1) out.push("…"); out.push(n); prev = n; }
    return out;
  };

  if (engineers.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40, fontSize: 13 }}>まだ enger.jp 経由で登録したエンジニアがいません。</div>;
  }

  return (
    <>
      <div className="card flush">
        <div className="tbl-toolbar">
          <div className="tbl-search">
            <Icons.search />
            <input placeholder="氏名・スキル・言語で検索…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="tbl-filter"><span>ステータス</span>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">すべて</option>
              {FRESH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="tbl-filter"><span>主要言語</span>
            <select value={filters.lang} onChange={(e) => setFilters((f) => ({ ...f, lang: e.target.value }))}>
              <option value="">すべて</option>
              {langOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="tbl-filter"><span>面談</span>
            <select value={filters.meeting} onChange={(e) => setFilters((f) => ({ ...f, meeting: e.target.value }))}>
              <option value="">すべて</option>
              <option value="done">面談済のみ</option>
            </select>
          </label>
          <label className="tbl-filter"><span>スキルシート</span>
            <select value={filters.sheet} onChange={(e) => setFilters((f) => ({ ...f, sheet: e.target.value }))}>
              <option value="">すべて</option>
              <option value="あり">あり</option>
              <option value="なし">なし</option>
            </select>
          </label>
          {/* 退会フィルタ：既定は「退会処理済みを除く」（通常+退会希望のみ表示）。 */}
          <label className="tbl-filter"><span>退会</span>
            <select value={filters.withdrawal} onChange={(e) => setFilters((f) => ({ ...f, withdrawal: e.target.value }))}>
              <option value="">通常（退会済みを除く）</option>
              <option value="wish">退会希望のみ</option>
              <option value="done">退会処理済みのみ</option>
              <option value="all">すべて</option>
            </select>
          </label>
          {matchingMsg && <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--color-danger)" }}>{matchingMsg}</span>}
        </div>

        <div className="tbl-scroll" style={{ overflowX: "auto" }}>
          <table className="tbl tbl-compact">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <input type="checkbox" aria-label="表示中をすべて選択" checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={toggleAll} style={{ accentColor: "var(--color-brand-600)" }} />
                </th>
                {/* #275①②：E番号のIDは「フリーランスID」表記に統一（人材ID＝P番号と区別）。 */}
                <th style={{ width: 100 }}>フリーランスID</th>
                {/* #300③：「ステータス」列を削除し、最終ログイン日時を左から2番目（ID の隣）へ移動。 */}
                <th style={{ width: 118, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("login")}
                  title="クリックで最終ログイン日時の昇順/降順を切替（未ログインは末尾）" aria-sort={sortKey === "login" ? (sortDir === "desc" ? "descending" : "ascending") : undefined}>
                  最終ログイン {sortKey === "login" ? (sortDir === "desc" ? "▼" : "▲") : <span style={{ opacity: .35 }}>▽</span>}
                </th>
                <th>氏名</th>
                <th>スキル</th>
                <th style={{ width: 92 }}>主要言語</th>
                <th style={{ width: 96 }} className="num">単価</th>
                {/* #262：スキルシート列（詳細にリンク自動挿入済み）・連絡先列は削除。 */}
                <th style={{ width: 76 }} className="num">GitHub</th>
                {/* #275④：登録日時はクリックで昇順/降順ソート。 */}
                <th style={{ width: 118, cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("created")}
                  title="クリックで登録日時の昇順/降順を切替" aria-sort={sortKey === "created" ? (sortDir === "desc" ? "descending" : "ascending") : undefined}>
                  登録日時 {sortKey === "created" ? (sortDir === "desc" ? "▼" : "▲") : <span style={{ opacity: .35 }}>▽</span>}
                </th>
                <th style={{ width: 76 }}>履歴</th>
                <th style={{ width: 76, textAlign: "center" }}>面談済</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)" }}>条件に一致する行がありません。</td></tr>
              ) : pageRows.map((e) => {
                const log = actions[e.id] ?? [];
                const sc = scouts[e.id] ?? [];
                const ap = applications[e.id] ?? [];
                const fav = favorites[e.id] ?? [];
                const prof = profileNames[e.id];
                // 氏名は「漢字氏名→人材ID」。アカウントID（display_name/github）は氏名として出さない。
                const name = resolveDisplayName(e, prof);
                const avatarText = avatarTextOf(name, prof);
                // #239①：名前の下の @ の隣に、プロフィール登録のイニシャルを表示（未登録なら @ のみ）。
                const sub = `@${(prof?.initials ?? "").trim()}`;
                return (
                  <tr key={e.id} className="clickable"
                    onClick={(ev) => { if ((ev.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setDetail(e); }}
                    title="クリックで詳細"
                    style={selected.has(e.id) ? { background: "var(--color-brand-25, #f0f6ff)" } : undefined}>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" aria-label={`${name} を選択`}
                        checked={selected.has(e.id)} onChange={() => toggleOne(e.id)}
                        style={{ accentColor: "var(--color-brand-600)" }} />
                    </td>
                    <td><span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>{shortId(e.id)}</span></td>
                    {/* #300③：最終ログイン日時を左から2番目（ID の隣）へ移動。ステータス（Fresh）列は削除。 */}
                    <td><span className="mono" style={{ fontSize: 11, color: "var(--color-ink-3)" }} title={e.last_login_at ? `最終ログイン：${fmtDateTime(e.last_login_at)}` : "ログイン履歴なし"}>{e.last_login_at ? fmtDateTime(e.last_login_at) : "—"}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {e.avatar_url ? <img src={e.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: 99, flex: "0 0 32px" }} /> : <div className="ava" style={{ flex: "0 0 32px" }}>{avatarText}</div>}
                        <div style={{ minWidth: 0 }}>
                          <div className="pri" style={{ color: "var(--color-brand-700)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span>{name}</span>
                            {/* #263 ログイン停止中バッジ：管理者が凍結したアカウント（ひと目で判別）。 */}
                            {e.login_suspended_at && (
                              <span title={`ログイン停止中（${fmtDateTime(e.login_suspended_at)} 停止）`} style={{ fontSize: 10, fontWeight: 800, padding: "1px 7px", borderRadius: 99, background: "#b42318", color: "#fff", border: "1px solid #b42318" }}>⛔ ログイン停止中</span>
                            )}
                            {/* 退会希望／退会済みバッジ：LP側で withdrawal_requested_at が立った時に表示。 */}
                            {e.withdrawal_completed_at
                              ? <span title={`退会処理済み（${fmtDateTime(e.withdrawal_completed_at)}）`} style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "var(--color-surface-inset)", color: "var(--color-ink-4)", border: "1px solid var(--color-border)" }}>退会済み</span>
                              : e.withdrawal_requested_at
                                ? <span title={`退会希望（${fmtDateTime(e.withdrawal_requested_at)}）`} style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf" }}>退会希望</span>
                                : null}
                          </div>
                          {sub && <div className="muted" style={{ fontSize: 10.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {/* #306⑤：スキル（brand）＋ツール・開発環境（accent）を同じ「スキル」列にタグ表示。
                          一覧は名前のみ（経験年数・工程は付けない＝#300の方針を維持）。先頭3件＋残数。 */}
                      {(() => {
                        const tags = [
                          ...skillNames(e).map((t) => ({ t, cls: "tag brand" })),
                          ...(e.tools ?? []).map((t) => ({ t, cls: "tag accent" })),
                        ];
                        if (tags.length === 0) return <span className="muted" style={{ fontSize: 12 }}>—</span>;
                        return (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {tags.slice(0, 3).map((x, i) => <span key={i} className={x.cls}>{x.t}</span>)}
                            {tags.length > 3 && <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>+{tags.length - 3}</span>}
                          </div>
                        );
                      })()}
                    </td>
                    <td><span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{e.primary_language ?? "—"}</span></td>
                    <td className="num"><span style={{ fontWeight: 600 }}>{pay(e)}</span></td>
                    <td className="num"><span className="muted" style={{ fontSize: 11.5 }}>★{e.total_stars} · {e.total_repos}</span></td>
                    {/* #262：スキルシート列・連絡先列は削除（スキルシートは詳細のプロフィールにリンク自動挿入済み）。 */}
                    {/* #300③：登録日時（最終ログインは ID の隣へ移動済み）。 */}
                    <td><span className="mono" style={{ fontSize: 11, color: "var(--color-ink-3)" }} title={`登録日時：${fmtDateTime(e.created_at)}`}>{fmtDateTime(e.created_at)}</span></td>
                    <td>
                      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {ap.length > 0 && <button type="button" title="応募した案件名を一覧で見る"
                          onClick={(ev) => { ev.stopPropagation(); setHistDetail({ engineer: e, kind: "応募" }); }}
                          style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc", cursor: "pointer", lineHeight: 1 }}>応募{ap.length}</button>}
                        {sc.length > 0 && <button type="button" title="スカウトした案件名を一覧で見る"
                          onClick={(ev) => { ev.stopPropagation(); setHistDetail({ engineer: e, kind: "スカ" }); }}
                          style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#e7f0fb", color: "#0b5cab", border: "1px solid #cfe0f5", cursor: "pointer", lineHeight: 1 }}>スカ{sc.length}</button>}
                        {/* 「対応」をハート（お気に入り数）に置換。クリックで該当フリーランスのお気に入り案件一覧を表示。 */}
                        {fav.length > 0 && (
                          <button type="button" title="お気に入り数"
                            onClick={(ev) => { ev.stopPropagation(); setFavDetail(e); }}
                            style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99, background: "#fdecef", color: "#d23f57", border: "1px solid #f7c5cf", cursor: "pointer", lineHeight: 1 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>favorite</span>{fav.length}
                          </button>
                        )}
                        {ap.length + sc.length + fav.length === 0 && <span className="muted" style={{ fontSize: 11 }}>—</span>}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" aria-label={`${name} を面談済にする`}
                        checked={meetingDoneIds.has(e.id)} disabled={meetingBusy === e.id}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => { ev.stopPropagation(); toggleMeetingDone(e); }}
                        title="面談済みのときチェック（対応履歴に記録されます）"
                        style={{ accentColor: "#067647", width: 17, height: 17, cursor: meetingBusy === e.id ? "wait" : "pointer" }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 一括操作バー（1件以上選択で出現）。LP登録者の整理・重複除去用。 */}
        {selected.size > 0 && (
          <div role="region" aria-label="一括操作"
            style={{ position: "sticky", bottom: 0, zIndex: 40, marginTop: 6, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "10px 14px", borderRadius: 12, background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", boxShadow: "0 -8px 24px rgba(15,23,42,.12)" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{selected.size} 名選択中</span>
            <button type="button" className="btn ghost btn-xs" onClick={() => setSelected(new Set())} disabled={bulkBusy}>選択解除</button>
            {/* #263 ログイン停止／解除：選択者の状態に応じて対象がある方だけ活性化。削除ボタンの左隣に配置。 */}
            <button type="button" onClick={() => setConfirmSuspend("suspend")} disabled={bulkBusy || nSuspendable === 0}
              title={nSuspendable === 0 ? "選択中に停止可能な（未停止の）ユーザーがいません" : "選択したユーザーのログインを強制停止します（凍結・いつでも解除可能）"}
              style={{ marginLeft: "auto", padding: "7px 16px", borderRadius: 8, border: "1px solid #b42318", background: nSuspendable === 0 ? "var(--color-surface-inset)" : "#b42318", color: nSuspendable === 0 ? "var(--color-ink-4)" : "#fff", fontSize: 12.5, fontWeight: 700, cursor: nSuspendable === 0 ? "not-allowed" : "pointer", opacity: bulkBusy ? 0.6 : 1 }}>
              ⛔ ログインを停止（{nSuspendable}名）
            </button>
            <button type="button" onClick={() => setConfirmSuspend("unsuspend")} disabled={bulkBusy || nUnsuspendable === 0}
              title={nUnsuspendable === 0 ? "選択中にログイン停止中のユーザーがいません" : "選択したユーザーのログイン制限を解除します（通常ログインへ復帰）"}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #bfe3cc", background: nUnsuspendable === 0 ? "var(--color-surface-inset)" : "#eef8f1", color: nUnsuspendable === 0 ? "var(--color-ink-4)" : "#067647", fontSize: 12.5, fontWeight: 700, cursor: nUnsuspendable === 0 ? "not-allowed" : "pointer", opacity: bulkBusy ? 0.6 : 1 }}>
              ✓ ログイン制限を解除（{nUnsuspendable}名）
            </button>
            <button type="button" onClick={() => setConfirmDel(true)} disabled={bulkBusy}
              style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid #f7c5cf", background: "#fdecef", color: "#b42318", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              🗑 選択した {selected.size} 名を削除
            </button>
          </div>
        )}

        {/* #263 ログイン停止/解除 確認モーダル（誤操作防止） */}
        {confirmSuspend && (
          <div onClick={() => !bulkBusy && setConfirmSuspend(null)} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20 }}>
            <div onClick={(ev) => ev.stopPropagation()} className="card" style={{ width: "min(460px, 96vw)", padding: 20 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>
                {confirmSuspend === "suspend" ? `${nSuspendable} 名のログインを停止します` : `${nUnsuspendable} 名のログイン制限を解除します`}
              </h3>
              <p style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7, margin: "0 0 14px" }}>
                {confirmSuspend === "suspend"
                  ? <>選択したユーザーのログインを強制停止しますか？停止すると、該当ユーザーはサービスサイトへのログインおよび利用ができなくなります。<br />※ データは残ります（物理削除ではありません）。いつでも「ログイン制限を解除」で元に戻せます。</>
                  : <>選択したユーザーのログイン制限を解除しますか？解除すると、該当ユーザーは再度サービスサイトへログインできるようになります。</>}
              </p>
              {matchingMsg && <div style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 10 }}>{matchingMsg}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn ghost btn-xs" onClick={() => setConfirmSuspend(null)} disabled={bulkBusy}>キャンセル</button>
                <button type="button" onClick={() => performSuspension(confirmSuspend === "suspend")} disabled={bulkBusy}
                  style={{ padding: "7px 16px", borderRadius: 8, border: 0, background: confirmSuspend === "suspend" ? "#b42318" : "#067647", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: bulkBusy ? 0.6 : 1 }}>
                  {bulkBusy ? "処理中…" : "実行"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 削除確認モーダル（#277：E番号側のみ完全削除・P番号は残す・再登録可能）。 */}
        {confirmDel && (
          <div onClick={() => !bulkBusy && setConfirmDel(false)} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20 }}>
            <div onClick={(ev) => ev.stopPropagation()} className="card" style={{ width: "min(460px, 96vw)", padding: 20 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>選択した {selected.size} 名のユーザーを削除しますか？</h3>
              <p style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7, margin: "0 0 14px" }}>
                この操作を実行すると、フリーランスのプロフィール情報（アカウント・認証情報を含む）は全て削除され、<b>元に戻せません</b>。
                <br />（※このフリーランスに紐づいているP番号の人材データは削除されません）
                <br />削除後、本人は同じメールアドレス／Googleアカウントで ENGERフリーランスへ最初から新規登録（再登録）できます。
              </p>
              {matchingMsg && <div style={{ fontSize: 12, color: "var(--color-danger)", marginBottom: 10 }}>{matchingMsg}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn ghost btn-xs" onClick={() => setConfirmDel(false)} disabled={bulkBusy}>キャンセル</button>
                <button type="button" onClick={performBulkDelete} disabled={bulkBusy}
                  style={{ padding: "7px 16px", borderRadius: 8, border: 0, background: "#b42318", color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: bulkBusy ? 0.6 : 1 }}>
                  {bulkBusy ? "削除中…" : "削除する"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="tbl-foot muted" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ whiteSpace: "nowrap" }}>{filtered.length.toLocaleString("ja-JP")} 名</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            <button type="button" className="pg-btn" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)} aria-label="前へ">‹</button>
            {buildPages(safePage + 1, pageCount).map((p, idx) => p === "…"
              ? <span key={`e${idx}`} style={{ padding: "0 4px", color: "var(--color-ink-4)" }}>…</span>
              : <button key={p} type="button" className={"pg-btn" + (p === safePage + 1 ? " active" : "")} onClick={() => setPage(p - 1)}>{p}</button>)}
            <button type="button" className="pg-btn" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} aria-label="次へ">›</button>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            件数：
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ fontFamily: "inherit", fontSize: 12, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }}>
              {[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </span>
        </div>
      </div>

      {detail && (
        <DetailModal engineer={detail} log={actions[detail.id] ?? []} scoutLog={scouts[detail.id] ?? []} appLog={applications[detail.id] ?? []} profile={profileNames[detail.id]} candidateNo={candidateNos[detail.id] ?? null} onClose={() => setDetail(null)} />
      )}

      {favDetail && (
        <FavoritesModal engineer={favDetail} favorites={favorites[favDetail.id] ?? []} profile={profileNames[favDetail.id]} onClose={() => setFavDetail(null)} />
      )}
      {histDetail && (
        <HistoryJobsModal engineer={histDetail.engineer} kind={histDetail.kind}
          applications={applications[histDetail.engineer.id] ?? []} scouts={scouts[histDetail.engineer.id] ?? []}
          profile={profileNames[histDetail.engineer.id]} onClose={() => setHistDetail(null)} />
      )}
    </>
  );
}

/** 履歴列の「応募」「スカ」クリックで開く案件名一覧モーダル。
 *  ①応募：その人材が応募した案件名。 ②スカ：案件ID(job_id/job_no)に紐づく“正しい案件名”のみ（スカウトタイトルは使わない）。 */
function HistoryJobsModal({ engineer, kind, applications, scouts, profile, onClose }: { engineer: Engineer; kind: "応募" | "スカ"; applications: Application[]; scouts: Scout[]; profile?: EngineerProfileName; onClose: () => void }) {
  const name = resolveDisplayName(engineer, profile);
  const items = kind === "応募"
    ? applications.map((a) => ({ key: a.id, job_no: a.job_no, title: a.job_title, created: a.created_at }))
    : scouts.filter((s) => (s.linked_job_title ?? "").trim()).map((s) => ({ key: s.id, job_no: s.job_no ?? null, title: s.linked_job_title!, created: s.created_at }));
  const heading = kind === "応募" ? `応募した案件（${items.length}）` : `スカウトした案件（${items.length}）`;
  const sub = kind === "応募" ? `${name} さんが応募した案件` : `${name} さんに送ったスカウト（案件IDに紐づく案件名のみ表示）`;
  const empty = kind === "応募" ? "応募した案件はありません。" : "案件IDに紐づくスカウトはありません。";
  const accent = kind === "応募" ? "#067647" : "#0b5cab";
  const icon = kind === "応募" ? "how_to_reg" : "campaign";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 320, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 480, maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 19, color: accent }}>{icon}</span>
            {heading}
          </h3>
          <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>{sub}</div>
        {items.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: 16, textAlign: "center" }}>{empty}</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it) => (
              <li key={it.key} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {it.job_no && <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>#{it.job_no}</span>}
                  {it.job_no ? (
                    <Link href={`/jobs/${it.job_no}`} target="_blank" rel="noopener noreferrer" title="案件詳細を開く"
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--color-brand-700)", textDecoration: "none" }}>
                      {it.title || "（無題の案件）"}
                    </Link>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{it.title || "（無題の案件）"}</span>
                  )}
                </div>
                {it.created && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{fmtDateTime(it.created)}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** お気に入り案件一覧モーダル：履歴列のハートをクリックで開く。該当フリーランスがお気に入りに入れた案件を表示。 */
function FavoritesModal({ engineer, favorites, profile, onClose }: { engineer: Engineer; favorites: JobFavorite[]; profile?: EngineerProfileName; onClose: () => void }) {
  const name = resolveDisplayName(engineer, profile);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 320, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 480, maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 19, color: "#d23f57", fontVariationSettings: "'FILL' 1" }}>favorite</span>
            お気に入り案件（{favorites.length}）
          </h3>
          <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: -6 }}>{name} さんがお気に入りに登録した案件</div>
        {favorites.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: 16, textAlign: "center" }}>お気に入り案件はありません。</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {favorites.map((f) => (
              <li key={f.job_id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {f.job_no && <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>#{f.job_no}</span>}
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{f.job_title || "（無題の案件）"}</span>
                  {!f.is_published && <span title="現在は非公開／募集終了の案件" style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "var(--color-surface-inset)", color: "var(--color-ink-4)", border: "1px solid var(--color-border)" }}>非公開</span>}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>登録：{fmtDateTime(f.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailModal({ engineer: detail, log, scoutLog, appLog, profile, candidateNo = null, onClose }: { engineer: Engineer; log: EngineerAction[]; scoutLog: Scout[]; appLog: Application[]; profile?: EngineerProfileName; candidateNo?: number | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [action, setAction] = useState<string>("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [scoutMsg, setScoutMsg] = useState("");
  const [scoutJob, setScoutJob] = useState("");
  const [scoutJobNo, setScoutJobNo] = useState("");                       // 案件ID（営業が入力）
  const [jobLookupMsg, setJobLookupMsg] = useState<{ tone: "ok" | "err" | "loading"; text: string } | null>(null);
  const titleEditedRef = useRef(false);                                   // 対象案件名を手入力で編集したか（自動入力の上書き判定）
  const [scoutErr, setScoutErr] = useState<string | null>(null);
  const [logPage, setLogPage] = useState(0);            // 対応履歴ページャ（5件/ページ）
  const [appPage, setAppPage] = useState(0);            // 応募した案件ページャ（5件/ページ）
  const [registerOpen, setRegisterOpen] = useState(false); // #250：人材マスタへ新規登録モーダル
  const [chatBusy, setChatBusy] = useState<string | null>(null); // チャット起動中の scout_id

  // 「スカウト送信」の対応履歴行に、対応するスカウト(scouts)を突合（scout_id/job_title を引く）。
  //   engineer_actions に scout_id が無いため、同一人材・近い作成時刻＋案件名で対応付ける
  //   （sendScout は scout と action を同時生成するため作成時刻はほぼ一致する）。
  const actionScout = useMemo(() => {
    const map = new Map<string, Scout>();
    const sends = log.filter((a) => a.action === "スカウト送信");
    const used = new Set<string>();
    for (const a of sends) {
      const at = new Date(a.created_at).getTime();
      const jt = (a.note?.match(/案件[:：]\s*(.+?)\s*$/)?.[1] ?? "").trim();
      let best: Scout | null = null;
      let bestDelta = Infinity;
      for (const s of scoutLog) {
        if (used.has(s.id)) continue;
        const sjt = (s.job_title ?? "").trim();
        if (jt && sjt && jt !== sjt) continue; // 案件名が両方あって不一致なら除外
        const d = Math.abs(new Date(s.created_at).getTime() - at);
        if (d < bestDelta) { best = s; bestDelta = d; }
      }
      if (best && bestDelta <= 5 * 60000) { map.set(a.id, best); used.add(best.id); } // 5分以内を同一とみなす
    }
    return map;
  }, [log, scoutLog]);

  // ① 5件/ページ。並びは現状（新しい順）を維持。
  const LOG_PER_PAGE = 5;
  const logPageCount = Math.max(1, Math.ceil(log.length / LOG_PER_PAGE));
  const safeLogPage = Math.min(logPage, logPageCount - 1);
  const pagedLog = log.slice(safeLogPage * LOG_PER_PAGE, safeLogPage * LOG_PER_PAGE + LOG_PER_PAGE);

  // ④ 応募した案件も 5件/ページ。6件目以降は 2,3ページ…でめくる。
  const APP_PER_PAGE = 5;
  const appPageCount = Math.max(1, Math.ceil(appLog.length / APP_PER_PAGE));
  const safeAppPage = Math.min(appPage, appPageCount - 1);
  const pagedApp = appLog.slice(safeAppPage * APP_PER_PAGE, safeAppPage * APP_PER_PAGE + APP_PER_PAGE);

  // 案件ID(数字)を入れたら、公開中の案件名を自動取得して「対象案件名」へ反映。
  //   ・入力のたびに少し待ってから問い合わせる（デバウンス）。
  //   ・案件IDが変わるたびに手入力フラグをリセットし、ロード中に手入力した案件名は上書きしない。
  //   ・紐づけ(jobs.id)はサーバ側(sendScout)で job_no から確定するため、ここでは保持しない（競合での誤紐づけ防止）。
  useEffect(() => {
    const no = scoutJobNo.trim();
    if (!no) { setJobLookupMsg(null); return; }
    if (!/^\d+$/.test(no)) { setJobLookupMsg({ tone: "err", text: "案件IDは数字で入力してください" }); return; }
    titleEditedRef.current = false; // 新しい案件IDなので自動入力を許可
    setJobLookupMsg({ tone: "loading", text: "案件名を取得中…" });
    let cancelled = false;
    const timer = setTimeout(async () => {
      const r = await lookupJobByNo(no);
      if (cancelled) return;
      if (r.ok) {
        if (!titleEditedRef.current) setScoutJob(r.title || `案件ID ${r.job_no ?? no}`); // ロード中の手入力は尊重
        setJobLookupMsg({ tone: "ok", text: `案件名を取得：${r.title || "（無題）"}` });
      } else {
        setJobLookupMsg({ tone: "err", text: r.error || "該当案件が見つかりません" });
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
    // setter/ref は安定。scoutJobNo の変化時のみ再実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoutJobNo]);

  // ③ 既存スレッドへ直接遷移。対応履歴に thread_id が無い古いスカウトは、DB優先の
  //    openScoutThread で「既存スレッドを探す→無ければ作成」してから遷移する（外部APIに依存しない）。
  // ③ チャットは別タブで開く。スレッドが既にあれば直接、無ければ生成してからそのタブへ遷移。
  const goThread = (threadId: string) => { if (threadId) window.open(`/chat?t=${threadId}`, "_blank", "noopener,noreferrer"); };
  const openChat = (scoutId: string) => {
    if (!scoutId || chatBusy) return;
    // ユーザー操作の同期内で空タブを先に開く（非同期後の window.open はポップアップブロック対象になるため）。
    const w = window.open("about:blank", "_blank");
    setChatBusy(scoutId);
    openScoutThread(scoutId).then((r) => {
      setChatBusy(null);
      if (r.ok && r.thread_id) {
        const url = `/chat?t=${r.thread_id}`;
        if (w && !w.closed) w.location.href = url; else window.open(url, "_blank", "noopener,noreferrer");
      } else {
        if (w && !w.closed) w.close();
        toast(r.error ?? "チャットを開けませんでした", "error");
      }
    }).catch((e) => { setChatBusy(null); if (w && !w.closed) w.close(); toast(e instanceof Error ? e.message : "チャットを開けませんでした", "error"); });
  };

  const submitScout = () => {
    if (!scoutMsg.trim()) { setScoutErr("スカウト本文を入力してください"); return; }
    setScoutErr(null);
    start(async () => {
      // 書き換え後の対象案件名・本文・案件ID(job_no)をセットで送信。jobs.id はサーバ側で job_no から確定する。
      const res = await sendScout({ engineer_id: detail.id, engineer_name: detail.display_name || detail.github_login, job_title: scoutJob, job_no: scoutJobNo.trim() || null, message: scoutMsg });
      if (!res.ok) { setScoutErr(res.error || "送信に失敗しました"); return; }
      setScoutMsg(""); setScoutJob(""); setScoutJobNo(""); setJobLookupMsg(null); titleEditedRef.current = false;
      router.refresh();
    });
  };

  const submit = () => {
    if (!action) { setErr("対応の種類を選んでください"); return; }
    setErr(null);
    start(async () => {
      const res = await addEngineerAction({ engineer_id: detail.id, engineer_name: detail.display_name || detail.github_login, action, note });
      if (!res.ok) { setErr(res.error || "保存に失敗しました"); return; }
      setAction(""); setNote("");
      router.refresh();
    });
  };
  const remove = (id: string) => {
    start(async () => { await deleteEngineerAction(id); router.refresh(); });
  };

  return (
    <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {detail.avatar_url ? <img src={detail.avatar_url} alt="" style={{ width: 48, height: 48, borderRadius: 99 }} /> : <div className="ava" style={{ width: 48, height: 48 }}>{avatarTextOf(resolveDisplayName(detail, profile), profile)}</div>}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{resolveDisplayName(detail, profile)}</h3>
                <SourceBadge source={detail.source} />
              </div>
              {/* 登録名の下：ENGERフリーランスのプロフィール登録情報（姓名漢字／フリガナ／イニシャル）。
                  #239：値が無い行は出さない（空ラベルを表示しない）。フリガナは姓カナ＋名カナ、その下にイニシャル。 */}
              {(() => {
                const kanji = (profile?.kanji ?? "").trim();
                const kana = (profile?.kana ?? "").trim();
                const ini = (profile?.initials ?? "").trim();
                if (!kanji && !kana && !ini) return null;
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 12, marginTop: 3 }}>
                    {kanji && <><span className="muted">姓名（漢字）</span><span>{kanji}</span></>}
                    {kana && <><span className="muted">姓名（フリガナ）</span><span>{kana}</span></>}
                    {ini && <><span className="muted">イニシャル</span><span>{ini}</span></>}
                  </div>
                );
              })()}
              {detail.headline && <div style={{ fontSize: 12, color: "var(--color-ink-2)", marginTop: 2 }}>{detail.headline}</div>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
            <button className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
            {/* #250：人材マスタ（人材一覧）へ新規登録。クリックで流し込み用データを初期セットしたフォームを開く。 */}
            <button type="button" className="btn btn-xs" onClick={() => setRegisterOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15, lineHeight: 1 }}>person_add</span>
              人材マスタへ新規登録
            </button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
          {[["想定単価", pay(detail)], ["★ Stars", detail.total_stars], ["リポジトリ", detail.total_repos]].map(([l, v], i) => (
            <div key={i} style={{ background: "var(--color-surface)", padding: "9px 11px" }}><div style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 600 }}>{l}</div><div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{String(v)}</div></div>
          ))}
        </div>
        <div>
          {/* #306②③④：スキルの隣に「ツール・開発環境」を並べ、どちらも最大2段＋「＋全て見る」。
              スキルは #300 のとおり経験年数・担当工程を付記（GitHubの熟練度 intermediate 等は非表示）。 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 5 }}>スキル</div>
              <TagCloud items={(detail.skills ?? []).map(skillTagLabel).filter(Boolean)} tagClass="tag" />
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 5 }}>ツール・開発環境</div>
              <TagCloud items={detail.tools ?? []} tagClass="tag accent" emptyText="未登録" />
            </div>
          </div>
        </div>
        {/* 連絡先（メール・電話）と登録情報。
            #275③：「メッセージ」項目は「人材ID」に変更し、人材マスタ登録済み（P番号発行済み）なら P番号を表示。 */}
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 600 }}>連絡先・登録情報</div>
          <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: "4px 10px", fontSize: 12.5 }}>
            {/* #275①：E番号は「フリーランスID」表記（人材ID＝P番号と区別）。 */}
            <span className="muted">フリーランスID</span><span className="mono">{shortId(detail.id)}</span>
            <span className="muted">登録日時</span><span className="mono">{fmtDateTime(detail.created_at)}</span>
            <span className="muted">メール</span><span>{detail.email ? <a href={`mailto:${detail.email}`} style={{ color: "var(--color-brand-700,#0b5cab)" }}>{detail.email}</a> : <span className="muted">—</span>}</span>
            <span className="muted">電話</span><span>{detail.phone ? <a href={`tel:${detail.phone}`} style={{ color: "var(--color-brand-700,#0b5cab)" }}>{detail.phone}</a> : <span className="muted">—</span>}</span>
            <span className="muted">人材ID</span><span>{candidateNo != null
              ? <a href={`/people/${candidateNo}`} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontWeight: 700, color: "var(--color-brand-700,#0b5cab)" }} title="人材詳細（P番号）を開く">P-{String(candidateNo).padStart(5, "0")}</a>
              : <span className="muted" title="「人材マスタへ登録」で P番号を発行すると表示されます">未登録</span>}</span>
          </div>
        </div>

        {/* 退会セクション：退会申請がある／処理済みのときだけ表示。
            ・申請のみ（処理未済） → 「退会処理する（無効化）」ボタンを赤系で出す
            ・処理済み           → 「退会処理を取り消す」を出す（誤操作救済） */}
        <WithdrawalSection engineer={detail} />


        {(detail.portfolio_url || (detail.skill_sheets?.length ?? 0) > 0 || detail.qiita_id) && (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            {detail.portfolio_url && (
              <a href={detail.portfolio_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-brand-700,#0b5cab)", fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>link</span>ポートフォリオ
              </a>
            )}
            {/* スキルシートは複数（最大3件）。各ファイルを個別リンクで開ける。 */}
            {(detail.skill_sheets ?? []).map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.name || `スキルシート${i + 1}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, color: sheetColor(s), fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{sheetIcon(s)}</span>
                {s.name || `スキルシート${i + 1}`}
              </a>
            ))}
            {detail.qiita_id && (
              <a href={`https://qiita.com/${detail.qiita_id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-brand-700,#0b5cab)", fontWeight: 600 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>article</span>Qiita
              </a>
            )}
          </div>
        )}

        {detail.bio && <div style={{ fontSize: 12, color: "var(--color-ink-2)", lineHeight: 1.7, whiteSpace: "pre-wrap", background: "var(--color-surface-inset)", padding: "8px 11px", borderRadius: 8 }}>{detail.bio}</div>}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: "var(--color-ink-4)" }}>
          <span>想定単価レンジ：{detail.estimated_pay_low ?? "—"}〜{detail.estimated_pay_high ?? "—"}万</span>
          <span>登録日：{detail.created_at ? new Date(detail.created_at).toLocaleDateString("ja-JP") : "—"}</span>
          {detail.last_login_at && <span>最終ログイン：{new Date(detail.last_login_at).toLocaleDateString("ja-JP")}</span>}
        </div>

        {/* 応募（エンジニアからの応募） */}
        {appLog.length > 0 && (
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>応募した案件 <span className="muted" style={{ fontWeight: 400 }}>（{appLog.length}件）</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pagedApp.map((a) => {
                return (
                  <div key={a.id} style={{ fontSize: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* 案件名は詳細ページ(/jobs/[job_no])へのリンク。job_no が無い場合はテキスト。 */}
                      {a.job_no ? (
                        <Link href={`/jobs/${a.job_no}`} target="_blank" rel="noopener noreferrer" title="案件詳細を開く"
                          style={{ color: "var(--color-brand-700,#0b5cab)", fontWeight: 600, minWidth: 0, flex: 1, textDecoration: "none" }}>
                          {a.job_title || `案件ID ${a.job_no}`}
                          {/* ③ № → 案件ID 表記 */}
                          <span className="mono" style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 400, marginLeft: 6 }}>案件ID {a.job_no}</span>
                        </Link>
                      ) : (
                        <span style={{ color: "var(--color-ink-2)", fontWeight: 600, minWidth: 0, flex: 1 }}>{a.job_title || "案件"}</span>
                      )}
                      {a.source_mail_url && (
                        <a href={a.source_mail_url} target="_blank" rel="noopener noreferrer" title="案件の元メール（Gmail）を開く"
                          style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-brand-700,#0b5cab)", fontWeight: 700, textDecoration: "none" }}>↗ 元メール</a>
                      )}
                      <span className="muted" style={{ fontSize: 10.5 }}>{fmtDate(a.created_at)}</span>
                    </div>
                  </div>
                );
              })}
              {/* ④ ページャ（6件目以降を2,3ページ…でめくる） */}
              {appPageCount > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 4 }}>
                  <button type="button" className="pg-btn" disabled={safeAppPage <= 0} onClick={() => setAppPage(safeAppPage - 1)} aria-label="前へ">‹</button>
                  {Array.from({ length: appPageCount }, (_, i) => i).map((p) => (
                    <button key={p} type="button" className={"pg-btn" + (p === safeAppPage ? " active" : "")} onClick={() => setAppPage(p)}>{p + 1}</button>
                  ))}
                  <button type="button" className="pg-btn" disabled={safeAppPage >= appPageCount - 1} onClick={() => setAppPage(safeAppPage + 1)} aria-label="次へ">›</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* スカウト（送信フォーム）。※ 送信済みスカウトの履歴一覧は下の「対応履歴」で確認できるため
            ここには表示しない（①：スカウト本文の下の履歴部分は削除）。 */}
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>スカウト</div>

          <div style={{ background: "var(--color-bg, #f7f8fa)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            {/* 案件ID（数字）→ 対象案件名を自動取得。対象案件名は自動入力後も自由に編集可。 */}
            <div style={{ display: "flex", gap: 8 }}>
              <input value={scoutJobNo} onChange={(e) => setScoutJobNo(e.target.value)} inputMode="numeric" placeholder="案件ID" title="案件ID（数字）を入れると対象案件名を自動取得します"
                style={{ width: 100, flex: "0 0 auto", fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }} />
              <input value={scoutJob} onChange={(e) => { titleEditedRef.current = true; setScoutJob(e.target.value); }} placeholder="対象案件名（任意・自動入力後も編集可）"
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }} />
            </div>
            {jobLookupMsg && (
              <div style={{ fontSize: 11, color: jobLookupMsg.tone === "err" ? "#b42318" : jobLookupMsg.tone === "ok" ? "#067647" : "var(--color-ink-4)" }}>{jobLookupMsg.text}</div>
            )}
            <textarea value={scoutMsg} onChange={(e) => setScoutMsg(e.target.value)} rows={3} placeholder="スカウト本文：案件の魅力・なぜあなたか・次のステップを簡潔に" style={{ fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", resize: "vertical" }} />
            {scoutErr && <div style={{ fontSize: 11.5, color: "#b42318" }}>{scoutErr}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              {/* #300④：外枠をブランド色で明示して見やすく（塗りつぶさず枠を強調・他デザインは維持）。 */}
              <button type="button" className="btn btn-xs" disabled={pending || jobLookupMsg?.tone === "loading"} onClick={submitScout} style={{ opacity: (pending || jobLookupMsg?.tone === "loading") ? 0.6 : 1, border: "1.5px solid var(--color-brand-600)", color: "var(--color-brand-700)", fontWeight: 700 }}>{pending ? "送信中…" : "スカウトを送る"}</button>
            </div>
          </div>

        </div>

        {/* 対応履歴 */}
        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>対応履歴 <span className="muted" style={{ fontWeight: 400 }}>（{log.length}件）</span></div>

          {/* 記録フォーム：タップ選択中心 */}
          <div style={{ background: "var(--color-bg, #f7f8fa)", border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ACTION_TYPES.map((a) => (
                <button key={a} type="button" onClick={() => setAction(a)}
                  className="tag" style={{ cursor: "pointer", fontSize: 11, fontWeight: 600, border: action === a ? "1.5px solid " + (ACTION_COLOR[a] || "#0b5cab") : "1px solid var(--color-border)", background: action === a ? (ACTION_COLOR[a] || "#0b5cab") : "var(--color-surface)", color: action === a ? "#fff" : "var(--color-ink-2)" }}>{a}</button>
              ))}
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（任意）：温度感・次の一手など" style={{ fontSize: 12, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)" }} />
            {err && <div style={{ fontSize: 11.5, color: "#b42318" }}>{err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              {/* #300④：外枠をブランド色で明示して見やすく（塗りつぶさず枠を強調・他デザインは維持）。 */}
              <button type="button" className="btn btn-xs" disabled={pending} onClick={submit} style={{ opacity: pending ? 0.6 : 1, border: "1.5px solid var(--color-brand-600)", color: "var(--color-brand-700)", fontWeight: 700 }}>{pending ? "記録中…" : "対応を記録"}</button>
            </div>
          </div>

          {/* 履歴リスト（① 5件/ページ・新しい順を維持） */}
          {log.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>まだ対応履歴はありません。上から記録できます。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pagedLog.map((a) => {
                const scout = a.action === "スカウト送信" ? actionScout.get(a.id) : undefined;
                // 案件名はマークの隣に1回だけ表示する。scout 突合できない時のみ note の「案件: XXX」から補完。
                const noteJob = a.action === "スカウト送信" ? (a.note?.match(/^\s*案件[:：]\s*(.+)$/)?.[1]?.trim() ?? "") : "";
                const jobTitle = (scout?.job_title ?? "").trim() || noteJob;
                const jobNo = scout?.job_no ?? null;
                const icon = ACTION_ICON[a.action];                    // ④ スカウト送信/チャット開始 を区別するアイコン
                const threadId = a.thread_id ?? null;                  // 履歴に紐づくスレッド（あれば即遷移）
                // ③④「チャットで連絡する」を出す行：スレッドに紐づく履歴 or スカウトに対応づく行。
                const showChat = a.action === "チャット開始" || a.action === "スカウト送信";
                const chatBusyId = scout?.id ?? a.id;
                return (
                  <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, padding: "7px 9px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 99, flex: "0 0 auto", color: "#fff", background: ACTION_COLOR[a.action] || "#475467" }}>
                      {icon && <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>}
                      {a.action}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {/* ②「スカウト送信」行のラベル隣に案件名＋案件ID（目立たないリンク・クリックで案件詳細）。
                          ③④ 案件名の隣に「チャットで連絡する」ボタン（該当スレッドへ遷移）。 */}
                      {showChat && (scout || jobTitle || threadId) && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                          {jobTitle && <span style={{ fontWeight: 700, color: "var(--color-ink)" }}>{jobTitle}</span>}
                          {/* ② 案件ID（目立たない表示）。クリックで案件詳細（/jobs/[job_no]）を開く。 */}
                          {jobNo && (
                            <Link href={`/jobs/${jobNo}`} target="_blank" rel="noopener noreferrer" title="案件詳細を開く"
                              onClick={(ev) => ev.stopPropagation()}
                              className="mono" style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 400, textDecoration: "none" }}>
                              案件ID {jobNo}
                            </Link>
                          )}
                          {(threadId || scout) && (
                            <button type="button"
                              onClick={() => threadId ? goThread(threadId) : (scout ? openChat(scout.id) : undefined)}
                              disabled={!threadId && chatBusy === chatBusyId}
                              className="btn ghost btn-xs" title="この人材とのチャットを開く"
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", color: "var(--color-brand-700)", borderColor: "var(--color-brand-200)" }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 14, lineHeight: 1 }}>chat</span>
                              {(!threadId && chatBusy === chatBusyId) ? "開いています…" : "チャットで連絡する"}
                            </button>
                          )}
                        </div>
                      )}
                      {/* #238：スカウト送信行の「案件: XXX」メモはマーク隣の案件名と重複するため非表示。 */}
                      {a.note && a.action !== "スカウト送信" && <div style={{ color: "var(--color-ink-2)" }}>{a.note}</div>}
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{fmtDate(a.created_at)}{a.operator ? ` · ${a.operator}` : ""}</div>
                    </div>
                    <button type="button" onClick={() => remove(a.id)} disabled={pending} title="削除" className="btn ghost btn-xs" style={{ flex: "0 0 auto", padding: "2px 7px", color: "#b42318" }}>×</button>
                  </div>
                );
              })}
              {/* ① ページャ（6件目以降を2,3ページ…でめくる） */}
              {logPageCount > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 4 }}>
                  <button type="button" className="pg-btn" disabled={safeLogPage <= 0} onClick={() => setLogPage(safeLogPage - 1)} aria-label="前へ">‹</button>
                  {Array.from({ length: logPageCount }, (_, i) => i).map((p) => (
                    <button key={p} type="button" className={"pg-btn" + (p === safeLogPage ? " active" : "")} onClick={() => setLogPage(p)}>{p + 1}</button>
                  ))}
                  <button type="button" className="pg-btn" disabled={safeLogPage >= logPageCount - 1} onClick={() => setLogPage(safeLogPage + 1)} aria-label="次へ">›</button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
    {registerOpen && <RegisterToMasterModal engineer={detail} onClose={() => setRegisterOpen(false)} />}
    </>
  );
}

// #250 登録モーダルのフィールド（モジュール直下に置き、入力ごとの再マウント＝フォーカス喪失を防ぐ）。
const REG_FIELD: CSSProperties = { fontSize: 12.5, padding: "6px 9px", border: "1px solid var(--color-border-strong)", borderRadius: 8, background: "var(--color-surface)", color: "var(--color-ink)", fontFamily: "inherit" };
const REG_LABEL: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--color-ink-3)" };
function RegField({ label, value, onChange, full, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; full?: boolean; placeholder?: string; type?: "text" | "date" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: full ? "1 / -1" : undefined }}>
      <span style={REG_LABEL}>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={REG_FIELD} />
    </label>
  );
}

// #250：人材マスタへ新規登録モーダル。開いた瞬間に対象フリーランスのデータを流し込み（初期セット）、
//   管理者が確認・編集して確定すると、新しいP番号で人材一覧に作成され、E↔P 紐付けが有効化される。
function RegisterToMasterModal({ engineer, onClose }: { engineer: Engineer; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ no?: number } | null>(null);
  const [pre, setPre] = useState<FreelancePrefill | null>(null);
  // 編集可能なフォーム値（流し込み後に管理者が確認・修正できる）。
  //   #262：所属区分の既定＝「弊社所属フリーランス」、所属会社の既定＝「ENGERフリーランス」、稼働開始（カレンダー選択）を追加。
  const [f, setF] = useState({
    name: "", title: "", affiliation: "弊社所属フリーランス", source_company: "ENGERフリーランス", avail_date: "", skills: "", rate: "",
    location: "", remote_pref: "", age_band: "", nationality: "", email: "",
  });

  useEffect(() => {
    let cancelled = false;
    prepareCandidateFromFreelancer(engineer.id).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok || !r.data) { setErr(r.error ?? "データの取得に失敗しました"); return; }
      const d = r.data;
      setPre(d);
      setF((s) => ({
        ...s,
        name: d.name, title: d.title, affiliation: d.affiliation || "弊社所属フリーランス",
        skills: (d.skills ?? []).join(", "), rate: d.rate, location: d.location,
        remote_pref: d.remote_pref, age_band: d.age_band, nationality: d.nationality, email: d.email,
      }));
    }).catch((e) => { if (!cancelled) { setLoading(false); setErr(e instanceof Error ? e.message : "取得に失敗しました"); } });
    return () => { cancelled = true; };
  }, [engineer.id]);

  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const labelStyle = REG_LABEL;

  const submit = () => {
    if (!f.name.trim()) { setErr("氏名（イニシャル）を入力してください"); return; }
    setErr(null);
    // 稼働開始：カレンダー選択（YYYY-MM-DD）→ 一覧・マッチングで読める「YYYY年M月D日〜」表記に変換。
    const availText = (() => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.avail_date);
      return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日〜` : null;
    })();
    start(async () => {
      const r = await registerCandidateFromFreelancer({
        engineer_id: engineer.id,
        name: f.name, title: f.title || null, affiliation: f.affiliation || "弊社所属フリーランス",
        source_company: f.source_company || "ENGERフリーランス",
        avail: availText,
        skills: f.skills ? f.skills.split(/[,、\/／]+/).map((s) => s.trim()).filter(Boolean) : [],
        rate: f.rate || null, rate_num: pre?.rate_num ?? null,
        location: f.location || null, remote_pref: f.remote_pref || null,
        age_band: f.age_band || null, nationality: f.nationality || null, email: f.email || null,
        skill_sheets: pre?.skill_sheets ?? [],
      });
      if (!r.ok) { setErr(r.error ?? "登録に失敗しました"); return; }
      setDone({ no: r.candidate_no });
      router.refresh();
    });
  };

  const pNo = done?.no ?? pre?.already_no ?? pre?.predicted_no ?? null;

  return (
    <div onClick={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", display: "grid", placeItems: "center", zIndex: 340, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 19, color: "var(--color-brand-700)" }}>person_add</span>
            人材マスタへ新規登録
          </h3>
          <button className="btn ghost btn-xs" onClick={onClose} disabled={pending}>閉じる</button>
        </div>

        {loading ? (
          <div className="muted" style={{ fontSize: 13, padding: 20, textAlign: "center" }}>流し込みデータを準備中…</div>
        ) : done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 4px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#067647" }}>✓ 人材マスタへ登録しました</div>
            {done.no != null && <div style={{ fontSize: 13 }}>人材ID（P番号）：<b className="mono">P-{String(done.no).padStart(5, "0")}</b></div>}
            <div className="muted" style={{ fontSize: 11.5 }}>元のフリーランス（{pre?.freelance_id}）と紐付け済み。応募が来ると提案ボードへ自動反映されます。</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <Link href="/people" className="btn btn-xs" onClick={onClose}>人材一覧を開く →</Link>
              <button type="button" className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
            </div>
          </div>
        ) : (
          <>
            {/* 人材ID（P番号）：保存時に自動採番。既にマスタ登録済みならその番号を表示。 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, padding: "8px 10px", borderRadius: 8, background: "var(--color-surface-inset)", border: "1px solid var(--color-border)" }}>
              <span style={labelStyle}>人材ID（P番号）</span>
              <b className="mono">{pNo != null ? `P-${String(pNo).padStart(5, "0")}` : "（保存時に自動採番）"}</b>
              {pre?.already_no == null && <span className="muted" style={{ fontSize: 10.5 }}>※ 見込み番号。確定保存時に採番されます。</span>}
              <span className="muted" style={{ marginLeft: "auto", fontSize: 10.5 }}>元: {pre?.freelance_id}</span>
            </div>
            {pre?.already_no != null && (
              <div style={{ fontSize: 12, color: "#b45309", background: "#fff7ed", border: "1px solid #f5b97f", borderRadius: 8, padding: "8px 10px" }}>
                このフリーランスは既に人材マスタへ登録済みです（P-{String(pre.already_no).padStart(5, "0")}）。再登録はされません。
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              <RegField label="氏名（イニシャル）" value={f.name} onChange={set("name")} placeholder="例：FT（空欄可）" />
              <RegField label="所属区分" value={f.affiliation} onChange={set("affiliation")} placeholder="弊社所属フリーランス" />
              <RegField label="所属会社" value={f.source_company} onChange={set("source_company")} placeholder="ENGERフリーランス" />
              <RegField label="稼働開始" type="date" value={f.avail_date} onChange={set("avail_date")} />
              <RegField label="職種" value={f.title} onChange={set("title")} />
              <RegField label="希望単価" value={f.rate} onChange={set("rate")} placeholder="例：50万〜60万" />
              <RegField label="年代（年齢幅つき）" value={f.age_band} onChange={set("age_band")} placeholder="例：30代後半（35~39歳）" />
              <RegField label="国籍" value={f.nationality} onChange={set("nationality")} placeholder="日本国籍 / 外国籍 / 不明" />
              <RegField label="最寄駅" value={f.location} onChange={set("location")} />
              <RegField label="リモート希望" value={f.remote_pref} onChange={set("remote_pref")} />
              <RegField label="連絡先（メール）" value={f.email} onChange={set("email")} full />
              <RegField label="スキルタグ（カンマ区切り）" value={f.skills} onChange={set("skills")} full />
            </div>

            {/* スキルシート（署名URL・ログイン不要で閲覧/DL可）。引き継ぎ対象を表示。 */}
            {(pre?.skill_sheets?.length ?? 0) > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={labelStyle}>スキルシート（引き継ぎ・共有リンク）</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(pre?.skill_sheets ?? []).map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.name || `スキルシート${i + 1}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--color-brand-700,#0b5cab)", fontWeight: 600, textDecoration: "none", border: "1px solid var(--color-border)", borderRadius: 8, padding: "4px 8px" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }}>description</span>{s.name || `スキルシート${i + 1}`}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
              ※ 空欄の項目はそのまま空欄で登録されます（初期テキストは入りません）。所属区分の既定は「弊社所属フリーランス」・所属会社の既定は「ENGERフリーランス」（どちらも編集可）。
              稼働開始はカレンダーで選択すると人材一覧の「稼働開始」欄に反映されます。確定すると人材一覧に新しいP番号で作成され、元のフリーランス（E番号）と紐付きます。
            </div>
            {err && <div style={{ fontSize: 12, color: "var(--color-danger)" }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={onClose} disabled={pending}>キャンセル</button>
              <button type="button" className="btn brand" onClick={submit} disabled={pending || pre?.already_no != null}>{pending ? "登録中…" : "この内容で登録"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 退会セクション（詳細モーダル内）。
//   ・LP で本人が退会申請 → withdrawal_requested_at が立つ → 赤バッジ＋「退会処理する」ボタン
//   ・営業が退会処理       → withdrawal_completed_at が立つ → グレー「退会済み」表示＋取消ボタン（救済）
function WithdrawalSection({ engineer: e }: { engineer: Engineer }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const isReq = !!e.withdrawal_requested_at;
  const isDone = !!e.withdrawal_completed_at;
  if (!isReq && !isDone) return null; // 退会と無関係なら何も出さない
  const onConfirm = () => {
    setErr(null);
    start(async () => {
      const res = await markEngineerWithdrawn(e.id);
      if (!res.ok) { setErr(res.error || "退会処理に失敗しました"); return; }
      setConfirm(false);
      router.refresh();
    });
  };
  const onUndo = () => {
    setErr(null);
    start(async () => {
      const res = await unmarkEngineerWithdrawn(e.id);
      if (!res.ok) { setErr(res.error || "取消に失敗しました"); return; }
      router.refresh();
    });
  };
  return (
    <div style={{ border: `1px solid ${isDone ? "var(--color-border)" : "#f7c5cf"}`, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, background: isDone ? "var(--color-surface-inset)" : "#fdecef" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: isDone ? "var(--color-ink-4)" : "#b42318", fontWeight: 700 }}>
          {isDone ? "退会処理済み" : "退会希望（要対応）"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: "4px 10px", fontSize: 12.5 }}>
        <span className="muted">申請日時</span>
        <span className="mono">{fmtDateTime(e.withdrawal_requested_at)}</span>
        <span className="muted">退会理由</span>
        <span style={{ whiteSpace: "pre-wrap" }}>{e.withdrawal_reason ? e.withdrawal_reason : <span className="muted">—</span>}</span>
        {isDone && (<>
          <span className="muted">処理日時</span>
          <span className="mono">{fmtDateTime(e.withdrawal_completed_at)}</span>
        </>)}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "var(--color-danger)" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!isDone && (
          confirm ? (
            <>
              <button type="button" disabled={pending} onClick={onConfirm}
                style={{ padding: "6px 12px", borderRadius: 8, border: 0, background: "#b42318", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
                {pending ? "処理中…" : "本当に退会処理する"}
              </button>
              <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => setConfirm(false)}>キャンセル</button>
            </>
          ) : (
            <button type="button" disabled={pending} onClick={() => setConfirm(true)}
              style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #f7c5cf", background: "#fff", color: "#b42318", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              退会処理する（無効化）
            </button>
          )
        )}
        {isDone && (
          <button type="button" className="btn ghost btn-xs" disabled={pending} onClick={onUndo}>
            退会処理を取り消す
          </button>
        )}
      </div>
    </div>
  );
}
