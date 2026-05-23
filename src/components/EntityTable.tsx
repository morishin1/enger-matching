"use client";

import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icons } from "./icons";
import { FocusHeart } from "./FocusHeart";
import { MailButton } from "./MailButton";
import { OutsideOwnerSelect } from "./OutsideOwnerSelect";
import { AffiliationSelect } from "./AffiliationSelect";
import { bulkSetFocus } from "@/lib/actions";

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

const JOB_COLS: Col[] = [
  { key: "id", label: "案件ID", width: 84, render: (j) => <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>No.{String(j.job_no ?? 0).padStart(5, "0")}</span> },
  { key: "status", label: "ステータス", width: 104, filterLabel: "ステータス", filter: (j) => freshnessLabel(j.created_at), filterFixed: FRESH_OPTIONS, render: (j) => <Fresh d={j.created_at} /> },
  {
    key: "title", label: "案件名", always: true,
    search: (j) => `${j.title ?? ""} ${(j.skills ?? []).join(" ")}`,
    render: (j) => <div className="pri" style={{ lineHeight: 1.4 }}>{j.title}</div>,
  },
  { key: "client", label: "クライアント名", search: (j) => j.client_name ?? "", render: (j) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{j.client_name ?? "—"}</span> },
  { key: "flow", label: "商流制限", width: 110, filterLabel: "商流", filter: (j) => j.flow_note || "不明", render: (j) => <span style={{ fontSize: 11.5, color: "var(--color-ink-4)" }}>{j.flow_note || "不明"}</span> },
  { key: "role", label: "職種", filterLabel: "職種", filter: (j) => j.role_label || "", render: (j) => (j.role_label ? <span className="tag" style={{ fontSize: 10.5 }}>{j.role_label}</span> : <span className="muted">—</span>) },
  { key: "remote", label: "リモート", width: 116, filterLabel: "リモート", filter: (j) => remoteLabel(j.remote_type), render: (j) => <span className="pill open">{remoteLabel(j.remote_type)}</span> },
  { key: "salary", label: "単価", width: 110, num: true, render: (j) => <span style={{ fontWeight: 600 }}>{salaryLabel(j.salary_min, j.salary_max)}</span> },
  { key: "created", label: "作成日", width: 100, num: true, render: (j) => <span className="muted">{dateLabel(j.created_at)}</span> },
  // ランクは一覧では非表示・フィルタのみ（単価帯）
  { key: "rank", label: "ランク", filterOnly: true, filterLabel: "ランク", filterFixed: RANK_OPTIONS, filter: (j) => salaryBand(j.salary_max ?? j.salary_min ?? null) },
];

const PEOPLE_COLS: Col[] = [
  { key: "id", label: "人材ID", width: 84, render: (p) => <span className="mono" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>P-{String(p.candidate_no ?? 0).padStart(5, "0")}</span> },
  { key: "status", label: "ステータス", width: 104, filterLabel: "ステータス", filter: (p) => freshnessLabel(p.created_at), filterFixed: FRESH_OPTIONS, render: (p) => <Fresh d={p.created_at} /> },
  {
    key: "name", label: "氏名", always: true,
    search: (p) => `${p.name ?? ""} ${(p.skills ?? []).join(" ")}`,
    render: (p) => (
      <Link href={`/people/${p.candidate_no}`} style={{ textDecoration: "none" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="ava">{p.initials || (p.name ?? "?").charAt(0)}</div>
          <div className="pri" style={{ color: "var(--color-brand-700)" }}>{p.name}</div>
        </div>
      </Link>
    ),
  },
  { key: "client", label: "クライアント名", search: (p) => p.source_company ?? "", render: (p) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.source_company ?? "—"}</span> },
  { key: "affiliation", label: "所属区分", width: 130, filterLabel: "所属区分", filter: (p) => p.affiliation || "未設定", render: (p) => <AffiliationSelect candidateNo={p.candidate_no} value={p.affiliation ?? null} /> },
  { key: "title", label: "職種", filterLabel: "職種", filter: (p) => p.title || "", render: (p) => <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>{p.title ?? "—"}</span> },
  { key: "remote", label: "リモート", width: 110, filterLabel: "リモート", filter: (p) => p.remote_pref || "", render: (p) => <span className="pill open">{p.remote_pref ?? "—"}</span> },
  { key: "salary", label: "単価", width: 110, num: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.rate ?? "—"}</span> },
  { key: "created", label: "登録日", width: 100, num: true, render: (p) => <span className="muted">{dateLabel(p.created_at)}</span> },
  { key: "rank", label: "ランク", filterOnly: true, filterLabel: "ランク", filterFixed: RANK_OPTIONS, filter: (p) => salaryBand(p.salary_max ?? p.salary_min ?? parseRate(p.rate)) },
];

export function EntityTable({ kind, rows, total, initialQuery, outsideOptions }: { kind: EntityKind; rows: any[]; total: number; initialQuery?: string; outsideOptions?: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cols = useMemo(() => {
    if (kind !== "jobs") return PEOPLE_COLS;
    const ownerCol: Col = {
      key: "outside_owner", label: "エンド担当", width: 124,
      filterLabel: "エンド担当", filter: (j) => j.outside_owner || "未設定",
      render: (j) => <OutsideOwnerSelect jobNo={j.job_no} value={j.outside_owner ?? null} options={outsideOptions ?? []} />,
    };
    // 「クライアント名」の直後に挿入
    const idx = JOB_COLS.findIndex((c) => c.key === "client");
    const out = [...JOB_COLS];
    out.splice(idx + 1, 0, ownerCol);
    return out;
  }, [kind, outsideOptions]);
  const idField = kind === "jobs" ? "job_no" : "candidate_no";
  const table = kind === "jobs" ? "jobs" : "candidates";
  const revalidate = kind === "jobs" ? "/jobs" : "/people";

  const [q, setQ] = useState(initialQuery ?? "");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(cols.filter((c) => c.defaultHidden).map((c) => c.key)));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [colMenu, setColMenu] = useState(false);
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

  // 行のメール(元メールへ飛ぶ) + マッチングリンク
  const mailFor = (r: any) => kind === "jobs"
    ? { url: r.source_mail_url, search: r.client_name || r.title, to: r.contact_email }
    : { url: r.source_mail_url, search: r.name || r.source_company, to: r.email ?? r.contact_email };
  const matchHref = (r: any) => kind === "jobs" ? `/matching?job=${r.job_no}` : `/matching?person=${r.candidate_no}`;

  const colSpan = visibleCols.length + 3; // checkbox + actions + heart

  return (
    <div className="card flush">
      <div className="tbl-toolbar">
        <div className="tbl-search">
          <Icons.search />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "jobs" ? "案件名・クライアント・スキルで検索…" : "氏名・スキル・クライアントで検索…"} />
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
            <button type="button" className="btn ghost" onClick={() => setSelected(new Set())}>選択解除</button>
          </div>
        </div>
      )}

      <div className="tbl-scroll" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全選択" /></th>
              {visibleCols.map((c) => <th key={c.key} className={c.num ? "num" : ""} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}
              <th style={{ width: 200 }}>アクション</th>
              <th style={{ width: 44 }}>注力</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={colSpan} style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)" }}>
                {rows.length === 0 ? "データがありません。" : "条件に一致する行がありません。"}
              </td></tr>
            ) : (
              filtered.map((r, i) => {
                const id = r[idField] as number;
                const m = mailFor(r);
                return (
                  <tr key={id ?? i} className={selected.has(id) ? "row-sel" : ""}>
                    <td><input type="checkbox" checked={selected.has(id)} onChange={() => toggleOne(id)} aria-label="選択" /></td>
                    {visibleCols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render!(r)}</td>)}
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <Link href={matchHref(r)} className="btn brand btn-xs" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>
                        <MailButton url={m.url} search={m.search} to={m.to} />
                      </div>
                    </td>
                    <td>
                      <FocusHeart key={`${id}-${r.is_focus ? 1 : 0}`} table={table} idField={idField as "job_no" | "candidate_no"} idValue={id} initial={!!r.is_focus} revalidate={revalidate} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tbl-foot muted">
        表示 {filtered.length.toLocaleString("ja-JP")} 件 / 取得 {rows.length.toLocaleString("ja-JP")} 件（全 {total.toLocaleString("ja-JP")} 件）
      </div>
    </div>
  );
}
