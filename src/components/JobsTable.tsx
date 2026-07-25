"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "@/components/AppLink";
import { useRouter, useSearchParams } from "next/navigation";
import { Icons } from "./icons";
import { FocusHeart } from "./FocusHeart";
import { MailButton } from "./MailButton";
import { OutsideOwnerSelect } from "./OutsideOwnerSelect";
import { EditJobButton } from "./EditEntryButton";
import { DeleteEntityButton } from "./DeleteEntityButton";
import { CloseToggleButton } from "./CloseToggleButton";
import { MeetingGateBanner } from "./MeetingGateBanner";
import { bulkSetFocus, bulkDeleteJobs, bulkSetClosed } from "@/lib/actions";
import { ClosedBadge } from "./ClosedBadge";
import { CompanyLink } from "./CompanyLink";
import { CompanyApprovalBadge } from "./CompanyApprovalBadge";
import { JobDetailNoteEditor } from "./JobDetailNoteEditor";
import { FreelanceNgSelect } from "./FreelanceNgSelect";
import { AgeLimitInput } from "./AgeLimitInput";
import { JobNatSelect } from "./JobNatSelect";
import { displayFlowNote } from "@/lib/flow";
import { classifyJobNationality, JOB_NAT_LABEL, JOB_NAT_TONE } from "@/lib/nationality";

// ---------- 表示用ヘルパ ----------
const remoteLabel = (r: string | null) =>
  r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");

const salaryLabel = (lo: number | null, hi: number | null) => {
  if (lo && hi) return lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`;
  if (hi) return `〜¥${hi}万`;
  if (lo) return `¥${lo}万〜`;
  return "スキル見合い";
};

const dateLabel = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
};

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
// 取込（インポート）日時の短縮表示。例: 6/19 14:30。ステータス列でバッジ下に併記する。
const importDateTime = (d: string | null) => {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
};
const Fresh = ({ d }: { d: string | null }) => {
  const label = freshnessLabel(d);
  const tone = label === "新着" ? "new" : label === "3日以内" ? "soon" : label === "4〜14日前" ? "mid" : "old";
  const dt = importDateTime(d);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
      <span className="fresh" data-tone={tone}><span className="dot" />{label}</span>
      {dt && <span className="muted" style={{ fontSize: 10.5, lineHeight: 1.2 }} title="取込（インポート）日時">{dt}</span>}
    </span>
  );
};

function SkillTags({ skills }: { skills?: unknown }) {
  const ss = Array.isArray(skills) ? (skills as string[]) : [];
  const top = ss.slice(0, 3);
  const more = ss.length - top.length;
  if (ss.length === 0) return <span className="muted" style={{ fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {top.map((s) => <span key={s} className="tag brand">{s}</span>)}
      {more > 0 && <span className="muted" style={{ fontSize: 11, fontWeight: 600 }}>+{more}</span>}
    </div>
  );
}

// ---------- 列定義 ----------
// filterKey が付いた列はサーバ側フィルタの対象（URL の f_<filterKey> に対応）。
type Col = {
  key: string;
  label: string;
  width?: number;
  always?: boolean;
  defaultHidden?: boolean;
  filterOnly?: boolean;     // テーブルには出さず、フィルタだけ提供
  num?: boolean;
  render?: (row: any, ctx: { outsideOptions: string[] }) => React.ReactNode;
  filterKey?: string;       // サーバフィルタのパラメータキー（= URL の f_<filterKey>）
  filterLabel?: string;
};

const JOB_COLS: Col[] = [
  { key: "id", label: "案件ID", width: 84, render: (j) => (
      <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
        <span>No.{String(j.job_no ?? 0).padStart(5, "0")}</span>
        {j.is_closed && <ClosedBadge size="xs" />}
      </span>
    ) },
  { key: "created", label: "掲載日", width: 96, defaultHidden: true, render: (j) => <span className="muted">{dateLabel(j.created_at)}</span> },
  { key: "status", label: "ステータス", width: 104, filterKey: "status", filterLabel: "ステータス", render: (j) => <Fresh d={j.created_at} /> },
  {
    key: "title", label: "案件名", always: true,
    render: (j) => (
      <div className="pri" style={{ lineHeight: 1.4, color: "var(--color-brand-700)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span>{j.title}</span>
        {/* LINE登録（signup_source='line'）はLINEマークで一目で識別できるようにする。 */}
        {j.signup_source === "line" && <span title="LINE経由で登録" style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={13} /></span>}
        {j.is_published === false && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf", flexShrink: 0 }}>非公開</span>}
        {j.has_proposal && <span className="tag" title="この案件で提案実績があります。削除に注意してください。" style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc", flexShrink: 0 }}>提案あり</span>}
      </div>
    ),
  },
  { key: "skills", label: "スキル", render: (j) => <SkillTags skills={j.skills} /> },
  { key: "client", label: "クライアント名", render: (j) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{j.client_name ?? "—"}</span> },
  { key: "approved", label: "承認", width: 96, filterKey: "approved", filterLabel: "承認状況", render: (j) => <CompanyApprovalBadge approved={!!j.client_approved} size="xs" /> },
  { key: "role", label: "職種", filterKey: "role", filterLabel: "職種", render: (j) => (j.role_label ? <span className="tag">{j.role_label}</span> : <span className="muted">—</span>) },
  { key: "remote", label: "リモート", width: 116, filterKey: "remote", filterLabel: "リモート", render: (j) => <span className="pill open">{remoteLabel(j.remote_type)}</span> },
  {
    key: "nationality", label: "国籍要件", width: 116, filterKey: "nationality", filterLabel: "国籍要件",
    render: (j) => {
      // 0724：保存済みの国籍要件(nationality_requirement)があればそれを表示。未設定のときだけ本文から自動判定。
      const SAVED_TO_CAT: Record<string, "jp_only" | "open" | "unknown"> = { "日本国籍のみ": "jp_only", "国籍不問": "open", "不明": "unknown" };
      const saved = String(j.nationality_requirement ?? "").trim();
      const cat = SAVED_TO_CAT[saved] ?? classifyJobNationality(j.detail, j.title);
      const tone = JOB_NAT_TONE[cat];
      return (
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}
          title={saved ? `国籍要件（保存済み）：${saved}` : cat === "jp_only" ? "外国籍NG（日本国籍のみ）の可能性。提案前に必ず確認。" : cat === "open" ? "国籍不問の可能性。" : "本文に国籍の記載が見当たりません。"}>
          {JOB_NAT_LABEL[cat]}
        </span>
      );
    },
  },
  { key: "salary", label: "単価", width: 110, num: true, render: (j) => <span style={{ fontWeight: 600 }}>{salaryLabel(j.salary_min, j.salary_max)}</span> },
  {
    key: "outside_owner", label: "エンド担当", width: 124, defaultHidden: true, filterKey: "outside_owner", filterLabel: "エンド担当",
    render: (j, ctx) => <OutsideOwnerSelect jobNo={j.job_no} value={j.outside_owner ?? null} options={ctx.outsideOptions} />,
  },
  { key: "flow", label: "商流制限", width: 110, defaultHidden: true, filterKey: "flow", filterLabel: "商流制限", render: (j) => <span style={{ fontSize: 11.5, color: "var(--color-ink-4)" }}>{displayFlowNote(j.flow_note) || "不明"}</span> },
  // ランクは一覧では非表示・フィルタのみ（単価帯）
  { key: "rank", label: "ランク", filterOnly: true, filterKey: "rank", filterLabel: "ランク" },
  // 登録元（LINE登録 / 通常）。タイトル列に LINE マークは出るが、絞り込み用にフィルタを追加。
  { key: "signup_source", label: "登録元", filterOnly: true, filterKey: "signup_source", filterLabel: "登録元" },
];

type Opt = { value: string; label: string };

export function JobsTable({
  rows, page, pageCount, total, pageSize, query, filters, filterOptions,
  outsideOptions = [], partner = false, meetingDone = true, initialDetail,
}: {
  rows: any[];
  page: number;          // 1-based
  pageCount: number;
  total: number;
  pageSize: number;
  query: string;
  filters: Record<string, string>;          // { <filterKey>: value }
  filterOptions: Record<string, Opt[]>;      // { <filterKey>: options }
  outsideOptions?: string[];
  partner?: boolean;
  meetingDone?: boolean;
  // ?focus=<id> でサーバ側 fetch した案件。指定があれば初期表示でドロワーを開く（現ページ外でも開ける）。
  initialDetail?: any | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  // --- URL クエリの一元更新（リロードしても状態を保持） ---
  const pushParams = (changes: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [k, v] of Object.entries(changes)) {
      if (v == null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    if (sp.get("page") === "1") sp.delete("page"); // page=1 は既定なので URL から省く
    const qs = sp.toString();
    start(() => router.replace(qs ? `/jobs?${qs}` : "/jobs", { scroll: false }));
  };

  // --- 検索（サーバ ilike）。デバウンスして URL ?q= に反映。フィルタ変更時と同じく page を 1 に戻す ---
  const [q, setQ] = useState(query ?? "");
  useEffect(() => {
    const cur = (query ?? "").trim();
    const next = q.trim();
    if (cur === next) return;
    const h = setTimeout(() => pushParams({ q: next || null, page: null }), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query]);

  const cols = JOB_COLS;
  const filterCols = cols.filter((c) => c.filterKey);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set(cols.filter((c) => c.defaultHidden).map((c) => c.key)));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [colMenu, setColMenu] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const colMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colMenu) return;
    const onDoc = (e: MouseEvent) => { if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) setColMenu(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colMenu]);

  // ページ・フィルタ・検索が変わったら選択をリセット（別ページに移っても選択が残り、操作バーが出っぱなしになるのを防ぐ）。
  // クライアント単独の再描画（行の選択操作など）では navKey は不変なので、同一ページ内の選択は維持される。
  const navKey = `${page}|${query}|${JSON.stringify(filters)}`;
  useEffect(() => { setSelected(new Set()); }, [navKey]);

  const visibleCols = cols.filter((c) => !c.filterOnly && !hidden.has(c.key));
  const ctx = useMemo(() => ({ outsideOptions }), [outsideOptions]);

  // 選択（現在ページ内）
  const pageIds = rows.map((r) => r.job_no).filter((v) => v != null) as number[];
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0;
  const toggleAll = () => setSelected((prev) => {
    if (allChecked) { const next = new Set(prev); pageIds.forEach((id) => next.delete(id)); return next; }
    return new Set([...prev, ...pageIds]);
  });
  const toggleOne = (id: number) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const doBulk = (value: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    start(async () => {
      const res = await bulkSetFocus("jobs", "job_no", ids, value, "/jobs");
      if (res.ok) { setSelected(new Set()); router.refresh(); }
    });
  };

  const doClose = (value: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    start(async () => {
      const res = await bulkSetClosed("jobs", "job_no", ids, value, "/jobs");
      if (res.ok) { setSelected(new Set()); router.refresh(); }
      else if (res.error) { setDeleteMsg({ ok: false, text: res.error }); setTimeout(() => setDeleteMsg(null), 5000); }
    });
  };

  const doDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    const res = await bulkDeleteJobs(ids);
    setDeleting(false);
    setDeleteConfirm(false);
    if (res.ok) {
      setDeleteMsg({ ok: true, text: `${ids.length} 件を削除しました` });
      setSelected(new Set());
      router.refresh();
    } else {
      setDeleteMsg({ ok: false, text: res.error ?? "削除に失敗しました" });
    }
    setTimeout(() => setDeleteMsg(null), 4000);
  };

  // 詳細ドロワー：?focus=<id> 経由ならサーバ側で fetch した initialDetail を初期表示する
  //   （現ページの rows に居ない案件でもドロワーが開く）。
  const [detail, setDetail] = useState<any | null>(initialDetail ?? null);
  // 行データ(rows)が更新されたら、開いている詳細ドロワーも最新の行で同期する。
  //   ※ 編集→保存→router.refresh() で rows は最新化されるが、detail は古い参照のままになる事故対策。
  useEffect(() => {
    if (!detail?.job_no) return;
    const fresh = rows.find((r) => r.job_no === detail.job_no);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [rows, detail?.job_no]);
  const [drawerIn, setDrawerIn] = useState(false);
  useEffect(() => {
    if (!detail) { setDrawerIn(false); return; }
    const id = requestAnimationFrame(() => setDrawerIn(true));
    return () => cancelAnimationFrame(id);
  }, [detail]);
  const closeDetail = () => { setDrawerIn(false); setTimeout(() => setDetail(null), 260); };
  // #406：バックドロップは「押下開始もクリックも背景自身」のときだけ閉じる。
  //   入力欄からのテキスト選択ドラッグが背景上で離れても閉じないようにする（編集中の誤閉じ防止）。
  const pressedBackdrop = useRef(false);
  const onBackdropDown = (e: React.MouseEvent) => { pressedBackdrop.current = e.target === e.currentTarget; };
  const onBackdropClick = (e: React.MouseEvent) => { if (pressedBackdrop.current && e.target === e.currentTarget) closeDetail(); };
  useEffect(() => {
    if (!detail) return;
    // #406：編集中に誤って閉じないようにする。入力欄にフォーカスがある間や
    //   日本語IMEの変換中（Escで変換キャンセル）は Esc で閉じない。入力欄の外で押したときだけ閉じる。
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e as any).isComposing || (e as any).keyCode === 229) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      closeDetail();
    };
    document.addEventListener("keydown", onKey);
    // #368①：広い画面（≥1280px）では右ドッキングの常設パネルなので body スクロールはロックしない。
    //   狭い画面は従来どおりオーバーレイのため背景スクロールをロックする。
    const isOverlay = typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches;
    const prev = document.body.style.overflow;
    if (isOverlay) document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); if (isOverlay) document.body.style.overflow = prev; };
  }, [detail]);

  const mailFor = (r: any) => ({ url: r.source_mail_url, search: [r.client_name, r.title].filter(Boolean).join(" ") || r.title, to: r.contact_email });
  const matchHref = (r: any) => `/matching?job=${r.job_no}`;
  const titleOf = (r: any) => r.title ?? `案件#${r.job_no}`;

  // 番号ページネーション（… で省略）
  const buildPages = (cur1: number, count: number) => {
    const win = [1, 2, cur1 - 1, cur1, cur1 + 1, count - 1, count].filter((n) => n >= 1 && n <= count);
    const uniq = [...new Set(win)].sort((a, b) => a - b);
    const out: (number | "…")[] = []; let prev = 0;
    for (const n of uniq) { if (n - prev > 1) out.push("…"); out.push(n); prev = n; }
    return out;
  };

  const safePage0 = Math.max(0, Math.min(page - 1, pageCount - 1));
  const colSpan = visibleCols.length + 3; // checkbox + actions + heart

  return (
    // #368①：テーブル（左）＋詳細パネル（右）のマスター詳細。広い画面で右ドッキング。
    <div className="jobs-md">
      <div className="card flush jobs-md-main">
      <div className="tbl-toolbar">
        <div className="tbl-search">
          <Icons.search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="案件名・案件No・クライアント名で検索…" />
        </div>
        {/* 商流制限の切り分けタブ：すべて／制限あり／制限なし（不問）。詳細カテゴリは下の「商流」プルダウン。 */}
        <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 10.5, fontWeight: 700, padding: "0 4px" }}>商流制限</span>
          {[
            { v: "", label: "すべて", fg: "var(--color-ink)" },
            { v: "restricted", label: "制限あり", fg: "#b42318" },
            { v: "none", label: "制限なし", fg: "#067647" },
          ].map((o) => {
            const on = (filters.flow_limit ?? "") === o.v;
            return (
              <button key={o.v} type="button" onClick={() => pushParams({ f_flow_limit: o.v || null, page: null })}
                style={{ padding: "5px 11px", borderRadius: 99, border: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700,
                  background: on ? "var(--color-surface)" : "transparent", color: on ? o.fg : "var(--color-ink-3)",
                  boxShadow: on ? "0 1px 2px rgba(15,23,42,.08)" : "none" }}>
                {o.label}
              </button>
            );
          })}
        </div>
        {filterCols.map((c) => {
          const fk = c.filterKey!;
          const opts = filterOptions[fk] ?? [];
          return (
            <label key={c.key} className="tbl-filter">
              <span>{c.filterLabel ?? c.label}</span>
              <select value={filters[fk] ?? ""} onChange={(e) => pushParams({ [`f_${fk}`]: e.target.value || null, page: null })}>
                <option value="">すべて</option>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          );
        })}
        <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12 }}>
          {/* #327：クローズ表示の切替（公開中のみ／クローズ済のみ／すべて）。クローズ済を一覧に出して
              「クローズ解除」で復帰できるようにする。既定は公開中のみ。 */}
          <label className="tbl-filter" title="クローズ済の案件を一覧に表示する（解除すると復帰します）">
            <span>クローズ</span>
            <select value={filters.closed ?? ""} onChange={(e) => pushParams({ f_closed: e.target.value || null, page: null })}>
              <option value="">公開中のみ</option>
              <option value="closed">クローズ済のみ</option>
              <option value="all">すべて表示</option>
            </select>
          </label>
          {/* 「提案あり」除外（提案実績のある案件を一覧から外す）。 */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-ink-2)", cursor: "pointer", whiteSpace: "nowrap" }} title="「提案あり」の案件を一覧から除外する">
            <input type="checkbox" checked={(filters.no_proposal ?? "") === "1"} onChange={(e) => pushParams({ f_no_proposal: e.target.checked ? "1" : null, page: null })} style={{ accentColor: "#067647" }} />
            提案ありを除外
          </label>
          {/* LINEのみ表示（signup_source=line のサーバフィルタを切替）＋件数（右上）。 */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--color-ink-2)", cursor: "pointer", whiteSpace: "nowrap" }} title="LINE経由で登録した案件だけを表示">
            <input type="checkbox" checked={(filters.signup_source ?? "") === "line"} onChange={(e) => pushParams({ f_signup_source: e.target.checked ? "line" : null, page: null })} style={{ accentColor: "#06C755" }} />
            <Icons.line size={14} /> LINEのみ
          </label>
          <span style={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>{total.toLocaleString("ja-JP")} <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-ink-4)" }}>件</span></span>
        </div>
        <div ref={colMenuRef} style={{ position: "relative" }}>
          <button type="button" className="btn ghost" onClick={() => setColMenu((v) => !v)} style={{ fontSize: 12 }}>
            <Icons.settings /><span>表示列</span>
          </button>
          {colMenu && (
            <div className="col-menu">
              <div className="col-menu-head">表示する列<span className="muted">{visibleCols.length}列</span></div>
              {cols.filter((c) => !c.filterOnly).map((c) => (
                <label key={c.key} className={"col-menu-item" + (c.always ? " disabled" : "")}>
                  <input type="checkbox" checked={!hidden.has(c.key)} disabled={c.always}
                    onChange={() => setHidden((h) => { const next = new Set(h); next.has(c.key) ? next.delete(c.key) : next.add(c.key); return next; })} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {someChecked && (
        <div className="bulk-bar">
          <span><b>{selected.size}</b> 件選択中</span>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button type="button" className="btn" onClick={() => doBulk(true)} disabled={pending} style={{ background: "#e0567f", color: "#fff", border: 0 }}>
              <span style={{ fontWeight: 700 }}>♥</span><span>注力に一括登録</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => doBulk(false)} disabled={pending}>注力を解除</button>
            {!partner && (
              <button type="button" className="btn ghost" onClick={() => doClose(true)} disabled={pending} title="一覧から外す（検索では表示。マッチング対象外）">
                <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>block</span> クローズ
              </button>
            )}
            {!partner && (
              <button type="button" className="btn ghost" onClick={() => doClose(false)} disabled={pending} title="クローズを解除して一覧・マッチングに復帰させる">
                <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>restart_alt</span> クローズ解除
              </button>
            )}
            {!partner && (
              <button type="button" className="btn ghost" onClick={() => setDeleteConfirm(true)} disabled={pending}
                style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)" }}>
                削除
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>選択解除</button>
          </div>
        </div>
      )}

      <div className="tbl-scroll" style={{ overflowX: "auto" }}>
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全選択" /></th>
              {visibleCols.map((c) => <th key={c.key} className={c.num ? "num" : ""} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              <th style={{ width: 230 }}>アクション</th>
              <th style={{ width: 44 }}>注力</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={colSpan} style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)" }}>
                {total === 0 ? "条件に一致する案件がありません。" : "このページには行がありません。"}
              </td></tr>
            ) : (
              rows.map((r, i) => {
                const id = r.job_no as number;
                const m = mailFor(r);
                return (
                  <tr key={id ?? i} className={"clickable " + (selected.has(id) ? "row-sel" : "")}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setDetail(r); }}
                    title="クリックで詳細">
                    <td><input type="checkbox" checked={selected.has(id)} onChange={() => toggleOne(id)} aria-label="選択" /></td>
                    {visibleCols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render!(r, ctx)}</td>)}
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {!r.is_closed && <Link href={matchHref(r)} className="btn btn-xs" title="マッチング" aria-label="マッチング" style={{ textDecoration: "none", background: "#DC143C", borderColor: "#DC143C", color: "#fff" }}><span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>auto_awesome</span></Link>}
                        {/* 元メールURLがあるときだけメールボタンを出す（要望：URL無→非表示。検索/composeフォールバックは廃止）。 */}
                        {r.source_mail_url && <MailButton url={r.source_mail_url} />}
                      </div>
                    </td>
                    <td>
                      <FocusHeart key={`${id}-${r.is_focus ? 1 : 0}`} table="jobs" idField="job_no" idValue={id} initial={!!r.is_focus} revalidate="/jobs" row={r} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tbl-foot muted" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ whiteSpace: "nowrap" }}>{total.toLocaleString("ja-JP")} 件</span>

        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <button type="button" className="pg-btn" disabled={safePage0 <= 0 || pending} onClick={() => pushParams({ page: String(safePage0) })} aria-label="前へ">‹</button>
          {buildPages(safePage0 + 1, pageCount).map((p, idx) => p === "…"
            ? <span key={`e${idx}`} style={{ padding: "0 4px", color: "var(--color-ink-4)" }}>…</span>
            : <button key={p} type="button" className={"pg-btn" + (p === safePage0 + 1 ? " active" : "")} disabled={pending} onClick={() => pushParams({ page: String(p) })}>{p}</button>)}
          <button type="button" className="pg-btn" disabled={safePage0 >= pageCount - 1 || pending} onClick={() => pushParams({ page: String(safePage0 + 2) })} aria-label="次へ">›</button>
        </span>

        <span style={{ whiteSpace: "nowrap" }}>1ページ {pageSize} 件</span>
      </div>

      </div>{/* /.jobs-md-main（テーブル本体） */}

      {/* #368①：詳細は右のパネルへ。広い画面（≥1280px）では右にドッキングした常設パネル、
          狭い画面では従来どおり右からのオーバーレイ。スタイルは globals.css の .jobs-md* を参照。 */}
      {detail && (
        <div className={"jobs-md-detail" + (drawerIn ? " in" : "")}>
          <div className="jobs-md-backdrop" onMouseDown={onBackdropDown} onClick={onBackdropClick} />
          <div
            onClick={(e) => e.stopPropagation()}
            className="card jobs-md-panel"
            role="dialog" aria-modal="true"
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>JOB · 案件詳細</div>
                <h3 style={{ margin: "2px 0 4px", fontSize: 18, fontWeight: 700, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span>{titleOf(detail)}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--color-ink-4)", fontWeight: 400 }}>No.{String(detail.job_no ?? 0).padStart(5, "0")}</span>
                  {detail.signup_source === "line" && <span title="LINE経由で登録" style={{ display: "inline-flex", alignItems: "center", lineHeight: 0 }}><Icons.line size={14} /></span>}
                  {detail.is_closed && <ClosedBadge size="xs" />}
                  {!partner && detail.client_name && <CompanyApprovalBadge approved={!!detail.client_approved} size="xs" />}
                </h3>
                <div className="sub" style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
                  {[detail.client_name, detail.role_label, remoteLabel(detail.remote_type), salaryLabel(detail.salary_min, detail.salary_max)].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <button className="btn ghost btn-xs" onClick={closeDetail}>閉じる</button>
            </div>

            {partner && !meetingDone && <MeetingGateBanner />}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!detail.is_closed && (
                <Link href={matchHref(detail)} className="btn brand" style={{ textDecoration: "none" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, lineHeight: 1 }}>auto_awesome</span><span>マッチング</span>
                </Link>
              )}
              {!partner && <Link href={`/jobs/${detail.job_no}`} className="btn ghost" style={{ textDecoration: "none" }}>案件ページへ</Link>}
              {detail.source_mail_url && <MailButton url={detail.source_mail_url} label="元メールを開く" block />}
              <EditJobButton job={detail} />
              {!partner && <CloseToggleButton kind="jobs" idValue={detail.job_no} isClosed={!!detail.is_closed} />}
              <DeleteEntityButton kind="jobs" idValue={detail.job_no} label={titleOf(detail)} />
            </div>

            {Array.isArray(detail.skills) && detail.skills.length > 0 && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>スキル</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(detail.skills as string[]).map((s) => <span key={s} className="tag brand" style={{ fontSize: 12 }}>{s}</span>)}
                </div>
              </div>
            )}

            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 4 }}>案件情報</div>
              {(() => {
                // 各項目は「ラベル：値」をコンパクトに詰めて表示（#331①：余白を減らし少しだけ左へ）。
                //   一部の項目は1行に2つ並べる（②単価×リモート／③国籍×年代／④勤務地×商流／⑤開始希望×ステータス／⑥窓口メール×担当者名）。
                const cell = (label: string, value: React.ReactNode) => (
                  <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13, minWidth: 0 }}>
                    <span className="muted" style={{ fontSize: 12, flexShrink: 0, whiteSpace: "nowrap" }}>{label}：</span>
                    <span style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap", wordBreak: "break-word", minWidth: 0 }}>{value}</span>
                  </div>
                );
                const rows: [string, React.ReactNode][][] = [
                  [["案件名", detail.title]],
                  [["クライアント", detail.client_name ? <CompanyLink name={detail.client_name} approved={!!detail.client_approved} badge badgeSize="xs" /> : null]],
                  [["募集職種", detail.role_label]],
                  [["必要スキル", (detail.skills ?? []).join(" / ") || null]],
                  [["単価", salaryLabel(detail.salary_min, detail.salary_max)], ["リモート可否", remoteLabel(detail.remote_type)]],
                  // 0723③：自動推定の「年代制限」バッジは廃止（年齢制限フィールドで代替）。国籍要件と年齢制限を1行に並べる。
                  [["国籍要件", <JobNatSelect key={`nat-${detail.job_no}`} jobNo={detail.job_no} initial={detail.nationality_requirement} detail={detail.detail} title={detail.title} compact />], ["年齢制限", <AgeLimitInput key={`agel-${detail.job_no}`} jobNo={detail.job_no} initial={detail.age_limit} compact />]],
                  // #368：勤務地・商流と同じ行に「フリーランスNG」の選択欄（商流の隣）。
                  [["勤務地", detail.work_location ?? "不明"], ["商流制限", displayFlowNote(detail.flow_note) || "不明"], ["フリーランスの応募", <FreelanceNgSelect key={`fng-${detail.job_no}`} jobNo={detail.job_no} initial={detail.freelance_ng} compact />]],
                  [["開始希望", detail.start_date], ["ステータス", detail.status]],
                  [["窓口メール", detail.contact_email], ["担当者名", detail.contact_name]],
                ];
                return rows.map((row, i) => {
                  const cells = row.filter(([, v]) => v != null && v !== "");
                  if (cells.length === 0) return null;
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: cells.length >= 3 ? "1fr 1fr 1fr" : cells.length === 2 ? "1fr 1fr" : "1fr", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--color-border)" }}>
                      {cells.map(([label, value]) => cell(label, value))}
                    </div>
                  );
                });
              })()}
            </div>

            {/* #331⑧：窓口メールの下・メール原文の上に「案件詳細」の入力欄。社内向けのみ表示。
                #368①：常設パネルは案件切替でアンマウントされないため、job_no を key にして
                選択案件ごとに確実に初期値・自動高さを反映させる（前の案件の値が残らないように）。 */}
            {!partner && <JobDetailNoteEditor key={detail.job_no} jobNo={detail.job_no} initial={detail.detail_note ?? ""} />}

            {detail.detail && (
              <div className="card" style={{ padding: 12 }}>
                {/* #331⑦：旧「案件詳細」＝取込メール原文なので「メール原文」に改称。 */}
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>メール原文</div>
                <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--color-ink-2)", maxHeight: 240, overflow: "auto" }}>{detail.detail}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteMsg && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 500, background: deleteMsg.ok ? "#1aa260" : "var(--color-danger)", color: "#fff", padding: "10px 20px", borderRadius: 99, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,.18)", whiteSpace: "nowrap" }}>
          {deleteMsg.text}
        </div>
      )}

      {deleteConfirm && (
        <div onClick={() => setDeleteConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>案件を削除しますか？</div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>
              <b style={{ color: "var(--color-danger)" }}>{selected.size} 件</b>を削除します。この操作は元に戻せません。
            </div>
            {(() => {
              const proposed = rows.filter((r: any) => selected.has(r.job_no) && r.has_proposal).length;
              if (proposed === 0) return null;
              return (
                <div style={{ fontSize: 12, color: "#b42318", background: "#fdecef", border: "1px solid #f7c5cf", borderRadius: 8, padding: "8px 11px", lineHeight: 1.6 }}>
                  ⚠ うち <b>{proposed} 件</b>は<b>「提案あり」</b>の案件です。提案実績ごと消えるため、本当に削除してよいかご確認ください。
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={() => setDeleteConfirm(false)} disabled={deleting}>キャンセル</button>
              <button type="button" className="btn" onClick={doDelete} disabled={deleting}
                style={{ background: "var(--color-danger)", borderColor: "var(--color-danger)", color: "#fff" }}>
                {deleting ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


