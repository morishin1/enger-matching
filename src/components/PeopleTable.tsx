"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "@/components/AppLink";
import { useRouter, useSearchParams } from "next/navigation";
import { Icons } from "./icons";
import { FocusHeart } from "./FocusHeart";
import { MailButton } from "./MailButton";
import { EditCandidateButton } from "./EditEntryButton";
import { DeleteEntityButton } from "./DeleteEntityButton";
import { bulkSetFocus, bulkDeleteCandidates, bulkSetClosed } from "@/lib/actions";
import { ClosedBadge } from "./ClosedBadge";
import { CompanyLink } from "./CompanyLink";
import { CompanyApprovalBadge } from "./CompanyApprovalBadge";
import { classifyCandNationality, CAND_NAT_LABEL, CAND_NAT_TONE } from "@/lib/nationality";

// ---------- 表示用ヘルパ ----------
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

// リモート希望（自由テキスト）を 3 区分の表示ラベルへ正規化。
// 分類の語彙は lib/match.ts の remoteFit と揃える（フル / リモート・在宅 / 出社・常駐）。
// ※ サーバ側フィルタ（people/page.tsx の remote バケット）の優先順位と必ず一致させること。
function remotePrefLabel(raw?: string | null): string | null {
  const cp = (raw ?? "").trim();
  if (!cp) return null;
  if (/フル/.test(cp)) return "フルリモート希望";
  if (/リモート|在宅/.test(cp)) return "一部リモート希望";
  if (/出社|常駐/.test(cp)) return "出社可";
  return cp; // 未分類はそのまま表示
}

// 国籍を 3 区分（日本国籍 / 外国籍 / 不明）のバッジで表示。原文（国名など）は title に保持。
function CandNatBadge({ value }: { value?: string | null }) {
  const cat = classifyCandNationality(value);
  const tone = CAND_NAT_TONE[cat];
  return (
    <span title={value ?? undefined} style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
      {CAND_NAT_LABEL[cat]}
    </span>
  );
}

function SkillTags({ skills }: { skills?: unknown }) {
  const ss = Array.isArray(skills) ? (skills as string[]) : [];
  // マッチング判定に重要なスキルが隠れないよう、基本は折り返しで全表示。
  //   極端に多い場合（8件超）だけ truncate して「+N」を出す（行が高くなりすぎないように）。
  const CAP = 8;
  const top = ss.slice(0, CAP);
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
  filterOnly?: boolean;
  num?: boolean;
  render?: (row: any) => React.ReactNode;
  filterKey?: string;
  filterLabel?: string;
};

const PEOPLE_COLS: Col[] = [
  { key: "id", label: "人材ID", width: 84, render: (p) => (
      <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)", display: "inline-flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
        <span>P-{String(p.candidate_no ?? 0).padStart(5, "0")}</span>
        {p.is_closed && <ClosedBadge size="xs" />}
      </span>
    ) },
  { key: "created", label: "登録日", width: 96, defaultHidden: true, render: (p) => <span className="muted">{dateLabel(p.created_at)}</span> },
  { key: "status", label: "ステータス", width: 104, filterKey: "status", filterLabel: "ステータス", render: (p) => <Fresh d={p.created_at} /> },
  {
    key: "name", label: "氏名", always: true,
    render: (p) => {
      const sub = p.affiliation || "";
      return (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="ava">{p.initials || (p.name ?? "?").charAt(0)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="pri" style={{ color: "var(--color-brand-700)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span>{p.name}</span>
              {/* LINE登録（signup_source='line'）はLINEマークで一目で識別できるようにする。 */}
              {p.signup_source === "line" && <span title="LINE経由で登録" style={{ lineHeight: 0, flexShrink: 0 }}><Icons.line size={13} /></span>}
              {p.has_proposal && <span className="tag" title="この人材で提案実績があります。削除に注意してください。" style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc", flexShrink: 0 }}>提案あり</span>}
            </div>
            {sub && <div className="muted" style={{ fontSize: 10.5, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
          </div>
        </div>
      );
    },
  },
  {
    key: "company", label: "会社", width: 168,
    render: (p) => {
      const co = p.source_company || p.company;
      return co
        ? <span style={{ fontSize: 12, color: "var(--color-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={co}>{co}</span>
        : <span className="muted" style={{ fontSize: 12 }}>—</span>;
    },
  },
  { key: "approved", label: "承認", width: 96, filterKey: "approved", filterLabel: "承認状況", render: (p) => <CompanyApprovalBadge approved={!!p.company_approved} size="xs" /> },
  { key: "skills", label: "スキル", render: (p) => <SkillTags skills={p.skills} /> },
  // 経験はLINE/AI取込で長文の経歴が入ることがあり一覧の行が崩れるため、既定非表示。
  //   詳細はドロワー下部の「経験・経歴」ブロックに表示する（表示列メニューで再表示も可）。
  { key: "exp", label: "経験", width: 76, defaultHidden: true, render: (p) => <span style={{ fontSize: 12 }}>{p.exp ? (/^\d+$/.test(String(p.exp).trim()) ? `${String(p.exp).trim()}年` : p.exp) : "—"}</span> },
  { key: "avail", label: "稼働開始", width: 112, render: (p) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.avail ?? "—"}</span> },
  { key: "title", label: "職種", filterKey: "title", filterLabel: "職種", render: (p) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.title ?? "—"}</span> },
  { key: "remote", label: "リモート", width: 130, filterKey: "remote", filterLabel: "リモート", render: (p) => <span className="pill open">{remotePrefLabel(p.remote_pref) ?? "—"}</span> },
  { key: "salary", label: "単価", width: 110, num: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.rate ?? "—"}</span> },
  // スキルシートは独立カラムを廃止し、アクション列のシートアイコンに集約（フィルタは維持）。
  { key: "skill_sheet", label: "スキルシート", filterOnly: true, filterKey: "skill_sheet", filterLabel: "スキルシート" },
  { key: "affiliation", label: "所属区分", width: 130, filterKey: "affiliation", filterLabel: "所属区分", render: (p) => <span style={{ fontSize: 12, color: p.affiliation ? "var(--color-ink)" : "var(--color-ink-4)" }}>{p.affiliation || "—"}</span> },
  // 国籍・年代を一覧に常時表示（プロフィールを開かなくても判断できるように）
  { key: "nationality", label: "国籍", width: 100, filterKey: "nationality", filterLabel: "国籍",
    render: (p) => {
      const v = (p as any).nationality as string | null | undefined;
      const cat = classifyCandNationality(v);
      if (cat === "unknown") return <span className="muted" style={{ fontSize: 11.5 }}>不明</span>;
      const tone = CAND_NAT_TONE[cat];
      // カテゴリ（日本国籍/外国籍）を表示し、原文（国名など）は title に保持。
      return (
        <span title={v ?? undefined} style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
          background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>{CAND_NAT_LABEL[cat]}</span>
      );
    },
  },
  { key: "age_band", label: "年代", width: 80,
    render: (p) => {
      const v = (p as any).age_band as string | null | undefined;
      return v ? <span style={{ fontSize: 12, color: "var(--color-ink-2)" }}>{v}</span> : <span className="muted" style={{ fontSize: 11.5 }}>—</span>;
    },
  },
  { key: "rank", label: "ランク", filterOnly: true, filterKey: "rank", filterLabel: "ランク" },
  // 登録元（LINE登録 / 通常）。氏名列に LINE マークは出るが、絞り込み用にフィルタを追加。
  { key: "signup_source", label: "登録元", filterOnly: true, filterKey: "signup_source", filterLabel: "登録元" },
];

type Opt = { value: string; label: string };

export function PeopleTable({
  rows, page, pageCount, total, pageSize, query, filters, filterOptions, initialDetail,
}: {
  rows: any[];
  page: number;          // 1-based
  pageCount: number;
  total: number;
  pageSize: number;
  query: string;
  filters: Record<string, string>;          // { <filterKey>: value }
  filterOptions: Record<string, Opt[]>;      // { <filterKey>: options }
  // ?focus=<id> でサーバ側 fetch した人材。指定があれば初期表示でドロワーを開く（現ページ外でも開ける）。
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
    if (sp.get("page") === "1") sp.delete("page");
    const qs = sp.toString();
    start(() => router.replace(qs ? `/people?${qs}` : "/people", { scroll: false }));
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

  const cols = PEOPLE_COLS;
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

  // 選択（現在ページ内）
  const pageIds = rows.map((r) => r.candidate_no).filter((v) => v != null) as number[];
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
      const res = await bulkSetFocus("candidates", "candidate_no", ids, value, "/people");
      if (res.ok) { setSelected(new Set()); router.refresh(); }
    });
  };

  const doClose = (value: boolean) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    start(async () => {
      const res = await bulkSetClosed("candidates", "candidate_no", ids, value, "/people");
      if (res.ok) { setSelected(new Set()); router.refresh(); }
      else if (res.error) { setDeleteMsg({ ok: false, text: res.error }); setTimeout(() => setDeleteMsg(null), 5000); }
    });
  };

  const doDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    const res = await bulkDeleteCandidates(ids);
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
  //   （現ページの rows に居ない人材でもドロワーが開く）。
  const [detail, setDetail] = useState<any | null>(initialDetail ?? null);
  // 行データ(rows)が更新されたら、開いている詳細ドロワーも最新の行で同期する。
  //   ※ 編集→保存→router.refresh() で rows は最新化されるが、detail は古いオブジェクト
  //     参照のままになり「詳細だけ反映されない」事故になっていた（一覧は反映される）。
  useEffect(() => {
    if (!detail?.candidate_no) return;
    const fresh = rows.find((r) => r.candidate_no === detail.candidate_no);
    if (fresh && fresh !== detail) setDetail(fresh);
  }, [rows, detail?.candidate_no]);
  const [drawerIn, setDrawerIn] = useState(false);
  useEffect(() => {
    if (!detail) { setDrawerIn(false); return; }
    const id = requestAnimationFrame(() => setDrawerIn(true));
    return () => cancelAnimationFrame(id);
  }, [detail]);
  const closeDetail = () => { setDrawerIn(false); setTimeout(() => setDetail(null), 260); };
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDetail(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [detail]);

  const mailFor = (r: any) => ({ url: r.source_mail_url, search: [r.name, r.source_company].filter(Boolean).join(" ") || r.name, to: r.email ?? r.contact_email });
  const matchHref = (r: any) => `/matching?person=${r.candidate_no}`;
  const titleOf = (r: any) => r.name ?? `人材#${r.candidate_no}`;

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
    <div className="card flush">
      <div className="tbl-toolbar">
        <div className="tbl-search">
          <Icons.search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名・人材No・会社名で検索…" />
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
            <button type="button" className="btn ghost" onClick={() => doClose(true)} disabled={pending} title="一覧から外す（検索では表示。マッチング対象外）">
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>block</span> クローズ
            </button>
            <button type="button" className="btn ghost" onClick={() => doClose(false)} disabled={pending} title="クローズを解除して一覧・マッチングに復帰させる">
              <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>restart_alt</span> クローズ解除
            </button>
            <button type="button" className="btn ghost" onClick={() => setDeleteConfirm(true)} disabled={pending}
              style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)" }}>
              削除
            </button>
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
                {total === 0 ? "条件に一致する人材がありません。" : "このページには行がありません。"}
              </td></tr>
            ) : (
              rows.map((r, i) => {
                const id = r.candidate_no as number;
                const m = mailFor(r);
                return (
                  <tr key={id ?? i} className={"clickable " + (selected.has(id) ? "row-sel" : "")}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return; setDetail(r); }}
                    title="クリックで詳細">
                    <td><input type="checkbox" checked={selected.has(id)} onChange={() => toggleOne(id)} aria-label="選択" /></td>
                    {visibleCols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render!(r)}</td>)}
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {!r.is_closed && <Link href={matchHref(r)} className="btn btn-xs" title="マッチング" aria-label="マッチング" style={{ textDecoration: "none", background: "#DC143C", borderColor: "#DC143C", color: "#fff" }}><span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>auto_awesome</span></Link>}
                        {/* 元メールURLがあるときだけメールボタンを出す（要望：URL無→非表示。検索/composeフォールバックは廃止）。 */}
                        {r.source_mail_url && <MailButton url={r.source_mail_url} />}
                        {r.skill_sheet_url && <a href={r.skill_sheet_url} target="_blank" rel="noopener noreferrer" className="btn btn-xs" title="スキルシートを開く" aria-label="スキルシート" style={{ textDecoration: "none", background: "#0095D9", borderColor: "#0095D9", color: "#fff" }}><span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>description</span></a>}
                      </div>
                    </td>
                    <td>
                      <FocusHeart key={`${id}-${r.is_focus ? 1 : 0}`} table="candidates" idField="candidate_no" idValue={id} initial={!!r.is_focus} revalidate="/people" row={r} />
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

      {/* 詳細ドロワー */}
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
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>SKILL SHEET · スキルシート</div>
                <h3 style={{ margin: "2px 0 4px", fontSize: 18, fontWeight: 700, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span>{titleOf(detail)}</span>
                  <span className="mono" style={{ fontSize: 12, color: "var(--color-ink-4)", fontWeight: 400 }}>P-{String(detail.candidate_no ?? 0).padStart(5, "0")}</span>
                  {detail.signup_source === "line" && <span title="LINE経由で登録" style={{ display: "inline-flex", alignItems: "center", lineHeight: 0 }}><Icons.line size={14} /></span>}
                  {detail.is_closed && <ClosedBadge size="xs" />}
                  {(detail.source_company || detail.company) && <CompanyApprovalBadge approved={!!detail.company_approved} size="xs" />}
                </h3>
                <div className="sub" style={{ fontSize: 12, color: "var(--color-ink-3)" }}>
                  {(() => { const co = detail.source_company || detail.company; const com = co && detail.affiliation ? `${co}（${detail.affiliation}）` : (co || detail.affiliation); return [detail.title, com].filter(Boolean).join(" · ") || "—"; })()}
                </div>
              </div>
              <button className="btn ghost btn-xs" onClick={closeDetail}>閉じる</button>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!detail.is_closed && (
                <Link href={matchHref(detail)} className="btn brand" style={{ textDecoration: "none" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 17, lineHeight: 1 }}>auto_awesome</span><span>マッチング</span>
                </Link>
              )}
              <Link href={`/people/${detail.candidate_no}`} className="btn ghost" style={{ textDecoration: "none" }}>人材ページへ</Link>
              {detail.skill_sheet_url && (
                <a href={detail.skill_sheet_url} target="_blank" rel="noreferrer" className="btn ghost" style={{ textDecoration: "none" }}>スキルシートを開く</a>
              )}
              {detail.source_mail_url && <MailButton url={detail.source_mail_url} label="元メールを開く" block />}
              <EditCandidateButton candidate={detail} />
              <DeleteEntityButton kind="candidates" idValue={detail.candidate_no} label={titleOf(detail)} />
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
              <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 4 }}>プロフィール</div>
              {/* 全項目を常に表示。データが無い項目は空欄、「不明」と記録のあるものは不明で表示。
                  ステータスは人材一覧と同じ鮮度（新着/3日以内/…）に統一（登録日が無ければ空欄）。 */}
              {([
                ["ステータス", detail.created_at ? freshnessLabel(detail.created_at) : ""],
                ["ランク", detail.rank ?? ""],
                ["年代", (detail as any).age_band ?? ""],
                ["国籍", (detail as any).nationality ? <CandNatBadge key="nat" value={(detail as any).nationality} /> : ""],
                ["希望単価", detail.rate ?? (detail.salary_min || detail.salary_max ? `${detail.salary_min ?? ""}〜${detail.salary_max ?? ""}万円` : "")],
                ["稼働開始", detail.avail ?? ""],
                ["リモート希望", remotePrefLabel(detail.remote_pref) ?? ""],
                ["最寄駅", detail.location ?? ""],
                ["所属", (detail.source_company || detail.company)
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><CompanyLink name={detail.source_company || detail.company} approved={!!detail.company_approved} badge badgeSize="xs" />{detail.affiliation ? <span className="muted" style={{ fontSize: 11.5 }}>（{detail.affiliation}）</span> : null}</span>
                  : (detail.affiliation ?? "")],
                ["連絡先", detail.email ?? detail.contact_email ?? ""],
                ["窓口担当者", (detail as any).contact_name ?? ""],
              ] as [string, React.ReactNode][]).map(([label, value]) => (
                <div key={label} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
                  <div className="muted" style={{ fontSize: 12 }}>{label}</div>
                  <div style={{ color: "var(--color-ink)", whiteSpace: "pre-wrap" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* 経験・経歴：案件詳細と同様に、長文をドロワー下部の独立ブロックで全文表示する。 */}
            {detail.exp && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>経験・経歴</div>
                <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--color-ink-2)", lineHeight: 1.7 }}>
                  {/^\d+$/.test(String(detail.exp).trim()) ? `${String(detail.exp).trim()}年` : detail.exp}
                </div>
              </div>
            )}

            {detail.note && (
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
            <div style={{ fontWeight: 700, fontSize: 15 }}>人材を削除しますか？</div>
            <div style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>
              <b style={{ color: "var(--color-danger)" }}>{selected.size} 件</b>を削除します。この操作は元に戻せません。
            </div>
            {(() => {
              const proposed = rows.filter((r: any) => selected.has(r.candidate_no) && r.has_proposal).length;
              if (proposed === 0) return null;
              return (
                <div style={{ fontSize: 12, color: "#b42318", background: "#fdecef", border: "1px solid #f7c5cf", borderRadius: 8, padding: "8px 11px", lineHeight: 1.6 }}>
                  ⚠ うち <b>{proposed} 件</b>は<b>「提案あり」</b>の人材です。提案実績ごと消えるため、本当に削除してよいかご確認ください。
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
