"use client";

import { useState, type ReactNode } from "react";
import Link from "@/components/AppLink";
import { Icons } from "./icons";
import { FocusHeart } from "./FocusHeart";
import { LineShareButton } from "./LineShareButton";
import { jobLineTemplate, candidateLineTemplate } from "@/lib/line-templates";
import type { LineworksTarget } from "@/lib/lineworks-targets";

const dt = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const remoteLabel = (r: string | null) => r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");
const salaryLabel = (lo: number | null, hi: number | null) => { if (lo && hi) return lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`; if (hi) return `〜¥${hi}万`; if (lo) return `¥${lo}万〜`; return "スキル見合い"; };

export function FocusList({ kind, items, headerTitle, unit, emptyText, removeOnUnheart, lineTargets }: {
  kind: "jobs" | "people"; items: any[];
  headerTitle?: ReactNode; unit?: string; emptyText?: ReactNode;
  removeOnUnheart?: boolean; // 注力リストでハートを外したら即座に行を消し、件数を減らす
  lineTargets?: LineworksTarget[]; // 渡すと詳細モーダルに「LINEに送る」（雛形の確認・編集→送信/コピー）を表示
}) {
  const [detail, setDetail] = useState<any | null>(null);
  const [list, setList] = useState<any[]>(items);
  const isJob = kind === "jobs";
  const idField = isJob ? "job_no" : "candidate_no";
  // items が変わったら（サーバ再フェッチ）同期
  const itemsKey = items.map((r) => r[idField]).join(",");
  const [prevKey, setPrevKey] = useState(itemsKey);
  if (prevKey !== itemsKey) { setPrevKey(itemsKey); setList(items); }
  const matchHref = (r: any) => isJob ? `/matching?job=${r.job_no}` : `/matching?person=${r.candidate_no}`;
  const title = (r: any) => isJob ? r.title : r.name;
  const candAff = (r: any) => { const c = r.source_company || r.company || ""; return c && r.affiliation ? `${c}（${r.affiliation}）` : (c || r.affiliation || ""); };
  const sub = (r: any) => isJob
    ? `${r.client_name ?? "—"} · ${remoteLabel(r.remote_type)} · ${salaryLabel(r.salary_min, r.salary_max)}`
    : `${r.title ?? "—"} · ${candAff(r)} · ${r.rate ?? salaryLabel(r.salary_min, r.salary_max)}`;

  const fields = (r: any): [string, any][] => isJob
    ? [["案件名", r.title], ["クライアント", r.client_name ?? "—"], ["職種", r.role_label ?? "—"], ["リモート", remoteLabel(r.remote_type)], ["単価", salaryLabel(r.salary_min, r.salary_max)], ["商流", r.flow_note ?? "—"], ["スキル", (r.skills ?? []).join(" / ") || "—"], ["詳細", r.detail ?? "—"]]
    : [["氏名", r.name], ["職種", r.title ?? "—"], ["所属会社", r.source_company ?? r.company ?? "—"], ["区分", r.affiliation ?? "—"], ["年齢層", r.age_band ?? "—"], ["単価", r.rate ?? salaryLabel(r.salary_min, r.salary_max)], ["リモート", r.remote_pref ?? "—"], ["経験", r.exp ?? "—"], ["ステータス", r.status ?? "—"], ["スキル", (r.skills ?? []).join(" / ") || "—"]];

  const rows = (
    <>
      {list.map((r) => (
        <div key={r[idField]} className="focus-row" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}
          onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,label,input")) return; setDetail(r); }} title="クリックで詳細">
          <FocusHeart table={isJob ? "jobs" : "candidates"} idField={idField as "job_no" | "candidate_no"} idValue={r[idField]} initial={!!r.is_focus} revalidate="/matching" row={r}
            onToggle={removeOnUnheart ? (on) => { if (!on) setList((p) => p.filter((x) => x[idField] !== r[idField])); } : undefined} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              {/* #316②：LINEから登録した案件/人材にはLINEバッジを付ける（サーバ側で _isLine を付与）。 */}
              {r._isLine && <span title="LINEから登録" style={{ lineHeight: 0, flexShrink: 0, display: "inline-flex" }}><Icons.line size={13} /></span>}
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title(r)}</span>
            </div>
            <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub(r)}</div>
            <div className="muted" style={{ fontSize: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
              {/* #316③：注力に登録した日（focused_at）。再注力すると最新日で上書きされる。 */}
              {r.focused_at && <span title="注力に登録した日"><span style={{ color: "#e0567f" }}>♥</span> 注力 {dt(r.focused_at)}</span>}
              <span>🕒 登録 {dt(r.created_at)}</span>
              {(r._focusWhy ?? []).map((w: string) => <span key={w} className="tag" style={{ fontSize: 9, padding: "0 5px" }}>{w}</span>)}
            </div>
          </div>
          <Link href={matchHref(r)} className="btn brand btn-xs" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>
        </div>
      ))}
    </>
  );

  const modal = detail && (
    <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
            {detail._isLine && <span title="LINEから登録" style={{ lineHeight: 0, display: "inline-flex" }}><Icons.line size={16} /></span>}
            {title(detail)}
          </h3>
          <button className="btn ghost btn-xs" onClick={() => setDetail(null)}>閉じる</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--color-border)", border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
          {fields(detail).map(([l, v], i) => (
            <div key={i} style={{ background: "var(--color-surface)", padding: "9px 11px", ...(l === "詳細" || l === "スキル" ? { gridColumn: "1 / -1" } : {}) }}>
              <div style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 13, marginTop: 2, whiteSpace: "pre-wrap" }}>{String(v ?? "—")}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Link href={matchHref(detail)} className="btn brand" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>
          {lineTargets && (
            <LineShareButton targets={lineTargets}
              text={isJob ? jobLineTemplate(detail) : candidateLineTemplate(detail)}
              buttonTitle={isJob ? "この案件情報をLINE向け雛形で確認・編集して送信/コピー" : "この人材情報（匿名）をLINE向け雛形で確認・編集して送信/コピー"} />
          )}
          {!isJob && <Link href={`/people/${detail.candidate_no}`} className="btn ghost" style={{ textDecoration: "none" }}>人材ページ</Link>}
        </div>
      </div>
    </div>
  );

  // ヘッダー(件数バッジ)付きカードとして描画するモード（注力リスト用）。件数は list.length に追従。
  if (headerTitle !== undefined) {
    return (
      <div className="card flush">
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{headerTitle}</div>
          <span className="tag brand">{list.length}{unit ?? ""}</span>
        </div>
        {list.length === 0
          ? <div style={{ padding: 28, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>{emptyText}</div>
          : rows}
        {modal}
      </div>
    );
  }

  return (<>{rows}{modal}</>);
}
