"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEngagementStatus, updateEngagementFields } from "@/lib/actions";

const STATUSES = ["予定", "稼働中", "終了"] as const;
const RENEWAL_STATUSES = ["継続", "未確認", "終了予定"];
const TONE: Record<string, { bg: string; fg: string }> = {
  予定: { bg: "#fef6e0", fg: "#9a7b12" },
  稼働中: { bg: "#e7f3ea", fg: "#1aa260" },
  終了: { bg: "#eef0f3", fg: "#5a6573" },
};
const DAY = 86400000;
const daysUntil = (d?: string | null) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / DAY) : null);
const dateVal = (d: string | null) => (d ? String(d).slice(0, 10) : "");

const cellInput = { fontFamily: "inherit", fontSize: 11.5, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;

export function EngagementsView({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const setStatus = (id: string, status: string) => start(async () => { await updateEngagementStatus(id, status); router.refresh(); });
  const saveField = (id: string, patch: Record<string, any>) => start(async () => { await updateEngagementFields(id, patch); router.refresh(); });

  if (rows.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
        まだ稼働がありません。<b style={{ color: "var(--color-ink-2)" }}>提案管理</b>で成約した提案の「稼働化」を押すとここに表示されます。
      </div>
    );
  }

  const live = rows.filter((e) => (e.status ?? "稼働中") === "稼働中" || e.status === "予定");
  const hasCostCol = rows.some((e) => "cost" in e);
  const miss = {
    end: live.filter((e) => !e.end_date).length,
    cost: hasCostCol ? live.filter((e) => e.cost == null).length : null,
  };
  const renewSoon = live.filter((e) => { const d = daysUntil(e.end_date); return d != null && d >= 0 && d <= 31; }).length;

  return (
    <>
      {/* 重要データ充足・更新アラート */}
      <div className="card" style={{ borderColor: (miss.end || renewSoon) ? "var(--color-warn,#e0a317)" : "var(--color-border)" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, fontSize: 13, alignItems: "center" }}>
          <span style={{ fontWeight: 700 }}>🛡 契約データ</span>
          <span>満了日 未入力 <b style={{ color: miss.end ? "#b42318" : "#067647" }}>{miss.end}</b></span>
          {miss.cost != null && <span>原価 未入力 <b style={{ color: miss.cost ? "#b45309" : "#067647" }}>{miss.cost}</b></span>}
          <span>30日以内に満了 <b style={{ color: renewSoon ? "#b45309" : "#067647" }}>{renewSoon}</b></span>
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>※ 満了日と原価を入れると、ダッシュボードの「契約更新アラート」と「粗利」が実数で表示されます。</div>
      </div>

      <div className="card flush tbl-scroll" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>案件 / 人材</th>
              <th style={{ width: 96 }}>月額(万)</th>
              <th style={{ width: 96 }}>原価(万)</th>
              <th style={{ width: 80 }}>粗利</th>
              <th style={{ width: 130 }}>満了日</th>
              <th style={{ width: 110 }}>更新意向</th>
              <th style={{ width: 130 }}>更新期限</th>
              <th style={{ width: 180 }}>ステータス</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const tone = TONE[e.status] ?? TONE["予定"];
              const rate = Number(e.monthly_rate);
              const cost = Number(e.cost);
              const gross = (!isNaN(rate) && !isNaN(cost) && e.cost != null) ? Math.round(rate - cost) : null;
              const d = daysUntil(e.end_date);
              const endTone = d != null && d >= 0 && d <= 31 ? "#b45309" : "var(--color-ink-4)";
              return (
                <tr key={e.id}>
                  <td><div className="pri">{e.job_title ?? "—"}</div><div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{e.company ?? ""}{e.candidate_name ? ` / ${e.candidate_name}` : ""}</div></td>
                  <td><input type="number" defaultValue={e.monthly_rate ?? ""} style={cellInput} disabled={pending} onBlur={(ev) => { const v = ev.target.value; if (String(v) !== String(e.monthly_rate ?? "")) saveField(e.id, { monthly_rate: v === "" ? null : Number(v) }); }} /></td>
                  <td><input type="number" defaultValue={e.cost ?? ""} placeholder="原価" style={cellInput} disabled={pending} onBlur={(ev) => { const v = ev.target.value; if (String(v) !== String(e.cost ?? "")) saveField(e.id, { cost: v === "" ? null : Number(v) }); }} /></td>
                  <td className="num" style={{ fontWeight: 700, color: gross != null ? (gross >= 0 ? "#067647" : "#b42318") : "var(--color-ink-4)" }}>{gross != null ? `${gross}万` : "—"}</td>
                  <td><input type="date" defaultValue={dateVal(e.end_date)} style={{ ...cellInput, color: endTone }} disabled={pending} onBlur={(ev) => { const v = ev.target.value; if (v !== dateVal(e.end_date)) saveField(e.id, { end_date: v || null }); }} /></td>
                  <td>
                    <select defaultValue={e.renewal_status ?? ""} style={cellInput} disabled={pending} onChange={(ev) => saveField(e.id, { renewal_status: ev.target.value || null })}>
                      <option value="">—</option>
                      {RENEWAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td><input type="date" defaultValue={dateVal(e.renewal_due)} style={cellInput} disabled={pending} onBlur={(ev) => { const v = ev.target.value; if (v !== dateVal(e.renewal_due)) saveField(e.id, { renewal_due: v || null }); }} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ padding: "3px 9px", borderRadius: 99, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{e.status}</span>
                      <div style={{ display: "flex", gap: 3 }}>
                        {STATUSES.filter((s) => s !== e.status).map((s) => (
                          <button key={s} type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => setStatus(e.id, s)}>{s}</button>
                        ))}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
