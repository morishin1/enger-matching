"use client";

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icons } from "./icons";
import { FocusHeart } from "./FocusHeart";
import { MailButton } from "./MailButton";
import { OutsideOwnerSelect } from "./OutsideOwnerSelect";
import { AffiliationSelect } from "./AffiliationSelect";
import { EditCandidateButton, EditJobButton } from "./EditEntryButton";
import { DeleteEntityButton } from "./DeleteEntityButton";
import { MeetingGateBanner } from "./MeetingGateBanner";
import { bulkSetFocus, bulkDeleteJobs, bulkDeleteCandidates } from "@/lib/actions";

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

// rate テキスト("70万円〜73万円")や数値から代表単価(万円)を取り出す
const parseRate = (rate: string | null): number | null => {
  if (!rate) return null;
  const nums = (rate.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 1000);
  return nums.length ? Math.max(...nums) : null;
};

// 単価ランク帯: A=90万〜 / B=70〜89万 / C=〜69万
const salaryBand = (n: number | null): string => (n == null ? "" : n >= 90 ? "A" : n >= 70 ? "B" : "C");
const RANK_OPTIONS = [
  { value: "A", label: "A（90万円〜）" },
  { value: "B", label: "B（70〜89万円）" },
  { value: "C", label: "C（〜69万円）" },
];

// 鮮度（作成/登録日からの経過日数）
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
const Fresh = ({ d }: { d: string | null }) => {
  const label = freshnessLabel(d);
  const tone = label === "新着" ? "new" : label === "3日以内" ? "soon" : label === "4〜14日前" ? "mid" : "old";
  return <span className="fresh" data-tone={tone}><span className="dot" />{label}</span>;
};

// ---------- 列定義 ----------
type Col = {
  key: string;
  label: string;
  width?: number;
  always?: boolean;        // 非表示にできない（表示列メニューでロック）
  defaultHidden?: boolean;
  filterOnly?: boolean;    // テーブルには出さず、フィルタだけ提供
  num?: boolean;
  render?: (row: any) => React.ReactNode;
  search?: (row: any) => string;
  filter?: (row: any) => string;
  filterLabel?: string;
  filterFixed?: { value: string; label: string }[]; // 固定の選択肢（ランク帯など）
};

export type EntityKind = "jobs" | "people";

// 上位3スキルをタグ表示（マッチ要因が一目で分かるよう、既定の .tag.brand スタイルで表示）
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

const JOB_COLS: Col[] = [
  { key: "id", label: "案件ID", width: 84, render: (j) => <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>No.{String(j.job_no ?? 0).padStart(5, "0")}</span> },
  { key: "created", label: "掲載日", width: 96, defaultHidden: true, render: (j) => <span className="muted">{dateLabel(j.created_at)}</span> },
  { key: "status", label: "ステータス", width: 104, filterLabel: "ステータス", filter: (j) => freshnessLabel(j.created_at), filterFixed: FRESH_OPTIONS, render: (j) => <Fresh d={j.created_at} /> },
  {
    key: "title", label: "案件名", always: true,
    search: (j) => `${j.job_no ?? ""} ${j.title ?? ""}`,
    render: (j) => (
      // 行クリックは常にドロワーで詳細を開く動線に統一。案件ページへの遷移はドロワー内ボタンから。
      <div className="pri" style={{ lineHeight: 1.4, color: "var(--color-brand-700)", display: "flex", alignItems: "center", gap: 6 }}>
        <span>{j.title}</span>
        {j.is_published === false && <span className="tag" style={{ fontSize: 9.5, padding: "1px 6px", background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf", flexShrink: 0 }}>非公開</span>}
      </div>
    ),
  },
  { key: "skills", label: "スキル", render: (j) => <SkillTags skills={j.skills} /> },
  { key: "client", label: "クライアント名", search: (j) => j.client_name ?? "", render: (j) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{j.client_name ?? "—"}</span> },
  { key: "role", label: "職種", filterLabel: "職種", filter: (j) => j.role_label || "", render: (j) => (j.role_label ? <span className="tag">{j.role_label}</span> : <span className="muted">—</span>) },
  { key: "remote", label: "リモート", width: 116, filterLabel: "リモート", filter: (j) => remoteLabel(j.remote_type), render: (j) => <span className="pill open">{remoteLabel(j.remote_type)}</span> },
  { key: "salary", label: "単価", width: 110, num: true, render: (j) => <span style={{ fontWeight: 600 }}>{salaryLabel(j.salary_min, j.salary_max)}</span> },
  { key: "flow", label: "商流制限", width: 110, defaultHidden: true, filterLabel: "商流", filter: (j) => j.flow_note || "不明", render: (j) => <span style={{ fontSize: 11.5, color: "var(--color-ink-4)" }}>{j.flow_note || "不明"}</span> },
  // ランクは一覧では非表示・フィルタのみ（単価帯）
  { key: "rank", label: "ランク", filterOnly: true, filterLabel: "ランク", filterFixed: RANK_OPTIONS, filter: (j) => salaryBand(j.salary_max ?? j.salary_min ?? null) },
];

const PEOPLE_COLS: Col[] = [
  { key: "id", label: "人材ID", width: 84, render: (p) => <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>P-{String(p.candidate_no ?? 0).padStart(5, "0")}</span> },
  { key: "created", label: "登録日", width: 96, defaultHidden: true, render: (p) => <span className="muted">{dateLabel(p.created_at)}</span> },
  { key: "status", label: "ステータス", width: 104, filterLabel: "ステータス", filter: (p) => freshnessLabel(p.created_at), filterFixed: FRESH_OPTIONS, render: (p) => <Fresh d={p.created_at} /> },
  {
    key: "name", label: "氏名", always: true,
    search: (p) => `${p.candidate_no ?? ""} ${p.name ?? ""}`,
    render: (p) => {
      // サブ行は区分(affiliation)のみ。会社名は独立の「会社」列で表示（見つけやすさ重視）。
      // 行クリックは常にドロワーで詳細を開く動線に統一（人材ページへの遷移はドロワー内ボタンから）。
      const sub = p.affiliation || "";
      return (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="ava">{p.initials || (p.name ?? "?").charAt(0)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="pri" style={{ color: "var(--color-brand-700)" }}>{p.name}</div>
            {sub && <div className="muted" style={{ fontSize: 10.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
          </div>
        </div>
      );
    },
  },
  // 会社名（所属）。該当人材を会社で見つけやすくするため独立カラムで表示。
  {
    key: "company", label: "会社", width: 168,
    search: (p) => `${p.source_company ?? ""} ${p.company ?? ""}`,
    render: (p) => {
      const co = p.source_company || p.company;
      return co
        ? <span style={{ fontSize: 12, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={co}>{co}</span>
        : <span className="muted" style={{ fontSize: 12 }}>—</span>;
    },
  },
  // マッチングの主要因。上位3スキル＋残数をタグ表示（既定の .tag.brand）。
  { key: "skills", label: "スキル", render: (p) => <SkillTags skills={p.skills} /> },
  { key: "exp", label: "経験", width: 76, render: (p) => <span style={{ fontSize: 12 }}>{p.exp ? (/^\d+$/.test(String(p.exp).trim()) ? `${String(p.exp).trim()}年` : p.exp) : "—"}</span> },
  { key: "avail", label: "稼働開始", width: 112, render: (p) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.avail ?? "—"}</span> },
  { key: "title", label: "職種", filterLabel: "職種", filter: (p) => p.title || "", render: (p) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.title ?? "—"}</span> },
  { key: "remote", label: "リモート", width: 110, filterLabel: "リモート", filter: (p) => p.remote_pref || "", render: (p) => <span className="pill open">{p.remote_pref ?? "—"}</span> },
  { key: "salary", label: "単価", width: 110, num: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.rate ?? "—"}</span> },
  {
    key: "skill_sheet", label: "スキルシート", width: 120,
    filterLabel: "スキルシート", filter: (p) => (p.skill_sheet_url ? "あり" : "なし"), filterFixed: [{ value: "あり", label: "あり" }, { value: "なし", label: "なし" }],
    render: (p) => p.skill_sheet_url
      ? <a href={p.skill_sheet_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none", color: "var(--color-brand-700)", fontSize: 12, fontWeight: 600 }}>スキルシート ↗</a>
      : <span className="muted" style={{ fontSize: 12 }}>—</span>,
  },
  { key: "affiliation", label: "所属区分", width: 130, filterLabel: "所属区分", filter: (p) => p.affiliation || "未設定", render: (p) => <AffiliationSelect candidateNo={p.candidate_no} value={p.affiliation ?? null} /> },
  { key: "rank", label: "ランク", filterOnly: true, filterLabel: "ランク", filterFixed: RANK_OPTIONS, filter: (p) => salaryBand(p.salary_max ?? p.salary_min ?? parseRate(p.rate)) },
];

export function EntityTable({ kind, rows, total, initialQuery, outsideOptions, partner = false, meetingDone = true, agentContact }: { kind: EntityKind; rows: any[]; total: number; initialQuery?: string; outsideOptions?: string[]; partner?: boolean; meetingDone?: boolean; agentContact?: { line?: string; email?: string; phone?: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cols = useMemo(() => {
    if (kind !== "jobs") return PEOPLE_COLS;
    const ownerCol: Col = {
      key: "outside_owner", label: "エンド担当", width: 124, defaultHidden: true,
      filterLabel: "エンド担当", filter: (j) => j.outside_owner || "未設定",
      render: (j) => <OutsideOwnerSelect jobNo={j.job_no} value={j.outside_owner ?? null} options={outsideOptions ?? []} />,
    };
    // 「単価」の直後に挿入（先頭の並びを崩さない）
    const idx = JOB_COLS.findIndex((c) => c.key === "salary");
    const out = [...JOB_COLS];
    out.splice(idx + 1, 0, ownerCol);
    return out;
  }, [kind, outsideOptions]);
  const idField = kind === "jobs" ? "job_no" : "candidate_no";
  const table = kind === "jobs" ? "jobs" : "candidates";
  const revalidate = kind === "jobs" ? "/jobs" : "/people";

  const [q, setQ] = useState(initialQuery ?? "");
  // 300件のクライアント側フィルタだけでは古い案件/人材が拾えないので、入力をURL(?q=)に反映して
  // サーバ側でDB全体を ilike 検索する。デバウンスして連打しないように。
  useEffect(() => {
    const cur = (initialQuery ?? "").trim();
    const next = q.trim();
    if (cur === next) return;
    const h = setTimeout(() => {
      const url = next ? `${revalidate}?q=${encodeURIComponent(next)}` : revalidate;
      router.replace(url, { scroll: false });
    }, 350);
    return () => clearTimeout(h);
  }, [q, initialQuery, revalidate, router]);
  const [filters, setFilters] = useState<Record<string, string>>({});
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

  const filterCols = cols.filter((c) => c.filter);
  const filterOptions = useMemo(() => {
    const map: Record<string, { value: string; label: string }[]> = {};
    for (const c of filterCols) {
      if (c.filterFixed) { map[c.key] = c.filterFixed; continue; }
      const set = new Set<string>();
      for (const r of rows) { const v = c.filter!(r); if (v) set.add(v); }
      map[c.key] = Array.from(set).sort((a, b) => a.localeCompare(b, "ja")).map((v) => ({ value: v, label: v }));
    }
    return map;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle) {
        const hay = cols.map((c) => (c.search ? c.search(r) : "")).join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      for (const c of filterCols) {
        const want = filters[c.key];
        if (want && c.filter!(r) !== want) return false;
      }
      return true;
    });
  }, [rows, q, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // ページング（描画負荷を抑える：既定50件/ページ・件数選択可）
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<any | null>(null);
  // 右からスライドインする詳細ドロワー。mount後に1フレーム置いて開く＝translateで滑らせる。
  const [drawerIn, setDrawerIn] = useState(false);
  useEffect(() => {
    if (!detail) { setDrawerIn(false); return; }
    const id = requestAnimationFrame(() => setDrawerIn(true));
    return () => cancelAnimationFrame(id);
  }, [detail]);
  const closeDetail = () => { setDrawerIn(false); setTimeout(() => setDetail(null), 260); };
  // 開いている間は背面スクロールを止め、Escで閉じる
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDetail(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [detail]);
  useEffect(() => { setPage(0); }, [q, filters, pageSize]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const ranked = filtered.some((r) => r._score != null);

  const visibleCols = cols.filter((c) => !c.filterOnly && !hidden.has(c.key));
  const allIds = filtered.map((r) => r[idField]).filter((v) => v != null) as number[];
  const allChecked = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someChecked = selected.size > 0;

  const toggleAll = () => setSelected((prev) => {
    if (allChecked) { const next = new Set(prev); allIds.forEach((id) => next.delete(id)); return next; }
    return new Set([...prev, ...allIds]);
  });
  const toggleOne = (id: number) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const doBulk = (value: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    start(async () => {
      const res = await bulkSetFocus(table, idField, ids, value, revalidate);
      if (res.ok) { setSelected(new Set()); router.refresh(); }
    });
  };

  const doDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    const res = kind === "jobs" ? await bulkDeleteJobs(ids) : await bulkDeleteCandidates(ids);
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

  // 行のメール(元メールへ飛ぶ) + マッチングリンク
  //   source_mail_url があれば該当メールへ直リンク。無ければ Gmail 検索（会社名＋案件名/氏名＋所属で絞り込み）。
  const mailFor = (r: any) => kind === "jobs"
    ? { url: r.source_mail_url, search: [r.client_name, r.title].filter(Boolean).join(" ") || r.title, to: r.contact_email }
    : { url: r.source_mail_url, search: [r.name, r.source_company].filter(Boolean).join(" ") || r.name, to: r.email ?? r.contact_email };
  const matchHref = (r: any) => kind === "jobs" ? `/matching?job=${r.job_no}` : `/matching?person=${r.candidate_no}`;
  const titleOf = (r: any) => kind === "jobs" ? (r.title ?? `案件#${r.job_no}`) : (r.name ?? `人材#${r.candidate_no}`);
  const rankBadge = (n: number) => n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : `${n}`;

  // 番号ページネーション（… で省略）
  const buildPages = (cur1: number, count: number) => {
    const win = [1, 2, cur1 - 1, cur1, cur1 + 1, count - 1, count].filter((n) => n >= 1 && n <= count);
    const uniq = [...new Set(win)].sort((a, b) => a - b);
    const out: (number | "…")[] = []; let prev = 0;
    for (const n of uniq) { if (n - prev > 1) out.push("…"); out.push(n); prev = n; }
    return out;
  };

  const colSpan = visibleCols.length + (ranked ? 4 : 3); // checkbox + (rank) + actions + heart

  return (
    <div className="card flush">
      <div className="tbl-toolbar">
        <div className="tbl-search">
          <Icons.search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "jobs" ? "案件名・案件No・クライアント名で検索…" : "氏名・人材No・会社名で検索…"} />
        </div>
        {filterCols.map((c) => (
          <label key={c.key} className="tbl-filter">
            <span>{c.filterLabel ?? c.label}</span>
            <select value={filters[c.key] ?? ""} onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}>
              <option value="">すべて</option>
              {filterOptions[c.key]?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        <div ref={colMenuRef} style={{ position: "relative", marginLeft: "auto" }}>
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
              {ranked && <th style={{ width: 150 }}>おすすめ順・理由</th>}
              {visibleCols.map((c) => <th key={c.key} className={c.num ? "num" : ""} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              <th style={{ width: 230 }}>アクション</th>
              <th style={{ width: 44 }}>注力</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={colSpan} style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)" }}>
                {rows.length === 0 ? "データがありません。" : "条件に一致する行がありません。"}
              </td></tr>
            ) : (
              pageRows.map((r, i) => {
                const id = r[idField] as number;
                const m = mailFor(r);
                const rank = safePage * pageSize + i + 1;
                return (
                  <tr key={id ?? i} className={"clickable " + (selected.has(id) ? "row-sel" : "")}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setDetail(r); }}
                    title="クリックで詳細">

                    <td><input type="checkbox" checked={selected.has(id)} onChange={() => toggleOne(id)} aria-label="選択" /></td>
                    {ranked && (
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <span style={{ fontWeight: 800, fontSize: rank <= 3 ? 16 : 13, color: rank <= 3 ? "var(--color-brand-700,#0b5cab)" : "var(--color-ink-3)" }}>{rankBadge(rank)}{rank > 3 ? <span style={{ fontSize: 10, fontWeight: 400 }}> 位</span> : ""}</span>
                          {(r._reasons ?? []).slice(0, 2).map((rs: string) => <span key={rs} className="tag" style={{ fontSize: 9.5, padding: "1px 6px" }}>{rs}</span>)}
                        </div>
                      </td>
                    )}
                    {visibleCols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render!(r)}</td>)}
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <Link href={matchHref(r)} className="btn btn-xs" title="マッチング" aria-label="マッチング" style={{ textDecoration: "none", background: "#DC143C", borderColor: "#DC143C", color: "#fff" }}><span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>auto_awesome</span></Link>
                        <MailButton url={m.url} search={m.search} to={m.to} />
                      </div>
                    </td>
                    <td>
                      <FocusHeart key={`${id}-${r.is_focus ? 1 : 0}`} table={table} idField={idField as "job_no" | "candidate_no"} idValue={id} initial={!!r.is_focus} revalidate={revalidate} row={r} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tbl-foot muted" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ whiteSpace: "nowrap" }}>{filtered.length.toLocaleString("ja-JP")} 件</span>

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

      {/* 詳細ドロワー（右からスライドイン。案件詳細／人材詳細ページと同じデザインベース） */}
      {detail && (
        <div onClick={closeDetail} style={{ position: "fixed", inset: 0, zIndex: 300, background: `rgba(15,23,42,${drawerIn ? 0.45 : 0})`, transition: "background .26s ease" }}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            role="dialog" aria-modal="true"
            style={{
              position: "absolute", top: 0, right: 0, height: "100%",
              width: "min(680px, 94vw)", maxWidth: "94vw",
              borderRadius: 0, borderTop: 0, borderRight: 0, borderBottom: 0,
              overflowY: "auto", display: "flex", flexDirection: "column", gap: 12,
              boxShadow: "-12px 0 32px rgba(15,23,42,.18)",
              transform: drawerIn ? "translateX(0)" : "translateX(100%)",
              transition: "transform .26s cubic-bezier(.22,.61,.36,1)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>
                  {kind === "jobs" ? "JOB · 案件詳細" : "SKILL SHEET · スキルシート"}
                </div>
                <h3 style={{ margin: "2px 0 4px", fontSize: 18, fontWeight: 700, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span>{titleOf(detail)}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--color-ink-4)", fontWeight: 400 }}>
                    {kind === "jobs" ? `No.${String(detail.job_no ?? 0).padStart(5, "0")}` : `P-${String(detail.candidate_no ?? 0).padStart(5, "0")}`}
                  </span>
                </h3>
                <div className="sub" style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
                  {kind === "jobs"
                    ? [detail.client_name, detail.role_label, remoteLabel(detail.remote_type), salaryLabel(detail.salary_min, detail.salary_max)].filter(Boolean).join(" · ") || "—"
                    : (() => { const co = detail.source_company || detail.company; const com = co && detail.affiliation ? `${co}（${detail.affiliation}）` : (co || detail.affiliation); return [detail.title, com].filter(Boolean).join(" · ") || "—"; })()}
                </div>
                {detail._reasons?.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>{detail._reasons.map((rs: string) => <span key={rs} className="tag" style={{ fontSize: 10.5, background: "var(--color-brand-25)", color: "var(--color-brand-700,#0b5cab)" }}>{rs}</span>)}</div>}
              </div>
              <button className="btn ghost btn-xs" onClick={closeDetail}>閉じる</button>
            </div>

            {/* 面談前ゲート案内（partner/freelance で未面談時） */}
            {partner && !meetingDone && <MeetingGateBanner />}

            {/* アクションバー（詳細ページと同等の動線） */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href={matchHref(detail)} className="btn brand" style={{ textDecoration: "none" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17, lineHeight: 1 }}>auto_awesome</span><span>マッチング</span>
              </Link>
              {/* テナント隔離ロールには個別詳細ページへの動線を出さない（漏洩防止） */}
              {!partner && (kind === "jobs"
                ? <Link href={`/jobs/${detail.job_no}`} className="btn ghost" style={{ textDecoration: "none" }}>案件ページへ</Link>
                : <Link href={`/people/${detail.candidate_no}`} className="btn ghost" style={{ textDecoration: "none" }}>人材ページへ</Link>)}
              {kind === "people" && detail.skill_sheet_url && !detail._anon && (
                <a href={detail.skill_sheet_url} target="_blank" rel="noreferrer" className="btn ghost" style={{ textDecoration: "none" }}>スキルシートを開く</a>
              )}
              {/* パートナーの匿名(他社)行は メール・編集・削除を出さない（漏洩/誤操作防止） */}
              {!(partner && detail._anon) && (
                <MailButton url={mailFor(detail).url} search={mailFor(detail).search} to={mailFor(detail).to} label={kind === "jobs" ? "窓口にメール" : "メールで紹介"} block />
              )}
              {!(partner && detail._anon) && (kind === "jobs"
                ? <EditJobButton job={detail} />
                : <EditCandidateButton candidate={detail} />)}
              {!(partner && detail._anon) && (
                <DeleteEntityButton kind={kind === "jobs" ? "jobs" : "candidates"} idValue={kind === "jobs" ? detail.job_no : detail.candidate_no} label={titleOf(detail)} />
              )}
            </div>

            {/* スキル */}
            {Array.isArray(detail.skills) && detail.skills.length > 0 && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>スキル</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(detail.skills as string[]).map((s) => <span key={s} className="tag brand" style={{ fontSize: 12 }}>{s}</span>)}
                </div>
              </div>
            )}

            {/* プロフィール／案件情報（ラベル + 値 の行レイアウト） */}
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 4 }}>
                {kind === "jobs" ? "案件情報" : "プロフィール"}
              </div>
              {(kind === "jobs"
                ? [
                    ["案件名", detail.title],
                    ["クライアント", detail.client_name],
                    ["募集職種", detail.role_label],
                    ["必要スキル", (detail.skills ?? []).join(" / ") || null],
                    ["単価", salaryLabel(detail.salary_min, detail.salary_max)],
                    ["リモート可否", remoteLabel(detail.remote_type)],
                    ["勤務地", detail.work_location ?? "不明"],
                    ["商流", detail.flow_note],
                    ["開始希望", detail.start_date],
                    ["ステータス", detail.status],
                    ["窓口メール", detail.contact_email],
                  ]
                : [
                    ["ステータス", detail.status],
                    ["ランク", detail.rank],
                    ["経験", detail.exp],
                    ["希望単価", detail.rate ?? (detail.salary_min || detail.salary_max ? `${detail.salary_min ?? ""}〜${detail.salary_max ?? ""}万円` : null)],
                    ["稼働開始", detail.avail],
                    ["リモート希望", detail.remote_pref],
                    ["最寄駅", detail.location ?? "不明"],
                    ["所属", detail.affiliation ?? detail.source_company],
                    ["連絡先", detail.email ?? detail.contact_email],
                  ]
              ).map(([label, value]) => value ? (
                <div key={label as string} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
                  <div className="muted" style={{ fontSize: 12 }}>{label}</div>
                  <div style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>{value as React.ReactNode}</div>
                </div>
              ) : null)}
            </div>

            {kind === "jobs" && detail.detail && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>案件詳細</div>
                <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--color-ink-2)", maxHeight: 240, overflow: "auto" }}>{detail.detail}</div>
              </div>
            )}
            {kind === "people" && detail.note && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>備考</div>
                <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--color-ink-2)" }}>{detail.note}</div>
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
            <div style={{ fontWeight: 700, fontSize: 15 }}>{kind === "jobs" ? "案件" : "人材"}を削除しますか？</div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>
              <b style={{ color: "var(--color-danger)" }}>{selected.size} 件</b>を削除します。この操作は元に戻せません。
            </div>
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
