"use client";

import { useState } from "react";
import Link from "next/link";
import { Icons } from "./icons";
import { FocusHeart } from "./FocusHeart";

const remoteLabel = (r: string | null) => r === "full_remote" ? "フルリモート" : r === "partial_remote" ? "一部リモート" : r === "onsite" ? "出社" : (r || "—");
const salaryLabel = (lo: number | null, hi: number | null) => { if (lo && hi) return lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`; if (hi) return `〜¥${hi}万`; if (lo) return `¥${lo}万〜`; return "スキル見合い"; };

export function FocusList({ kind, items }: { kind: "jobs" | "people"; items: any[] }) {
  const [detail, setDetail] = useState<any | null>(null);
  const isJob = kind === "jobs";
  const idField = isJob ? "job_no" : "candidate_no";
  const matchHref = (r: any) => isJob ? `/matching?job=${r.job_no}` : `/matching?person=${r.candidate_no}`;
  const title = (r: any) => isJob ? r.title : r.name;
  const sub = (r: any) => isJob
    ? `${r.client_name ?? "—"} · ${remoteLabel(r.remote_type)} · ${salaryLabel(r.salary_min, r.salary_max)}`
    : `${r.title ?? "—"} · ${r.affiliation ?? r.source_company ?? ""} · ${r.rate ?? salaryLabel(r.salary_min, r.salary_max)}`;

  const fields = (r: any): [string, any][] => isJob
    ? [["案件名", r.title], ["クライアント", r.client_name ?? "—"], ["職種", r.role_label ?? "—"], ["リモート", remoteLabel(r.remote_type)], ["単価", salaryLabel(r.salary_min, r.salary_max)], ["商流", r.flow_note ?? "—"], ["スキル", (r.skills ?? []).join(" / ") || "—"], ["詳細", r.detail ?? "—"]]
    : [["氏名", r.name], ["職種", r.title ?? "—"], ["所属", r.affiliation ?? r.source_company ?? "—"], ["年齢層", r.age_band ?? "—"], ["単価", r.rate ?? salaryLabel(r.salary_min, r.salary_max)], ["リモート", r.remote_pref ?? "—"], ["経験", r.exp ?? "—"], ["ステータス", r.status ?? "—"], ["スキル", (r.skills ?? []).join(" / ") || "—"]];

  return (
    <>
      {items.map((r) => (
        <div key={r[idField]} className="focus-row" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}
          onClick={(e) => { if ((e.target as HTMLElement).closest("a,button,label,input")) return; setDetail(r); }} title="クリックで詳細">
          <FocusHeart table={isJob ? "jobs" : "candidates"} idField={idField as "job_no" | "candidate_no"} idValue={r[idField]} initial={!!r.is_focus} revalidate="/matching" row={r} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title(r)}</div>
            <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub(r)}</div>
          </div>
          <Link href={matchHref(r)} className="btn brand btn-xs" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>
        </div>
      ))}

      {detail && (
        <div onClick={() => setDetail(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 300, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title(detail)}</h3>
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
            <div style={{ display: "flex", gap: 8 }}>
              <Link href={matchHref(detail)} className="btn brand" style={{ textDecoration: "none" }}><Icons.matching /><span>マッチング</span></Link>
              {!isJob && <Link href={`/people/${detail.candidate_no}`} className="btn ghost" style={{ textDecoration: "none" }}>人材ページ</Link>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
