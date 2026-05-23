"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEngagementStatus, updateEngagementFields } from "@/lib/actions";
import type { Role } from "@/lib/roles";

const STATUSES = ["予定", "稼働中", "終了"] as const;
const AFFILIATIONS = ["プロパー", "BP", "フリーランス"];
const RENEWAL_STATUSES = ["未着手", "打診中", "更新合意", "更新済", "終了予定"];
const COLLECT = ["未", "送付済", "回収済"];
const TONE: Record<string, { bg: string; fg: string }> = {
  予定: { bg: "#fef6e0", fg: "#9a7b12" }, 稼働中: { bg: "#e7f3ea", fg: "#1aa260" }, 終了: { bg: "#eef0f3", fg: "#5a6573" },
};
const collectTone = (s?: string | null) => s === "回収済" ? "#1aa260" : s === "送付済" ? "#9a7b12" : "#d23f57"; // 未/null=赤
const DAY = 86400000;
const daysUntil = (d?: string | null) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / DAY) : null);
const dateVal = (d: string | null) => (d ? String(d).slice(0, 10) : "");

const inp = { fontFamily: "inherit", fontSize: 12, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;
const Lbl = ({ c }: { c: string }) => <div style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 2 }}>{c}</div>;
/** 権限なしマスク表示（未入力と区別：F-6） */
const Locked = () => <span title="閲覧権限がありません" style={{ fontSize: 11.5, color: "var(--color-ink-4)" }}>🔒 権限なし</span>;

export function EngagementsView({ rows, role = "admin" }: { rows: any[]; role?: Role }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isAdmin = role === "admin";
  const setStatus = (id: string, status: string) => start(async () => { await updateEngagementStatus(id, status); router.refresh(); });
  const save = (id: string, patch: Record<string, any>) => start(async () => { await updateEngagementFields(id, patch); router.refresh(); });

  if (rows.length === 0) {
    return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>まだ稼働がありません。<b style={{ color: "var(--color-ink-2)" }}>提案管理</b>で成約した提案の「稼働化」を押すと表示されます。</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
      {rows.map((e) => {
        const tone = TONE[e.status] ?? TONE["予定"];
        const masked = e._maskMargin;
        const rate = Number(e.monthly_rate);
        const cost = Number(e.cost);
        const gross = (!masked && !isNaN(rate) && !isNaN(cost) && e.cost != null) ? Math.round(rate - cost) : null;
        const d = daysUntil(e.end_date);
        const endSoon = d != null && d >= 0 && d <= 31;
        return (
          <div key={e.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
            {/* ヘッダー */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{e.job_title ?? "—"}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{e.company ?? ""}{e.candidate_name ? ` / ${e.candidate_name}` : ""}</div>
              </div>
              <span style={{ padding: "3px 9px", borderRadius: 99, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{e.status}</span>
            </div>

            {/* 所属区分 */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Lbl c="所属区分" />
              {isAdmin ? (
                <select defaultValue={e.affiliation ?? ""} style={{ ...inp, width: 120 }} disabled={pending} onChange={(ev) => save(e.id, { affiliation: ev.target.value || null })}>
                  <option value="">未設定</option>{AFFILIATIONS.map((a) => <option key={a}>{a}</option>)}
                </select>
              ) : <span className="tag" style={{ fontSize: 10.5 }}>{e.affiliation || "未設定"}</span>}
            </div>

            {/* 利益（権限×所属でマスク） */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><Lbl c="月額(万)" /><input type="number" defaultValue={e.monthly_rate ?? ""} style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.monthly_rate ?? "")) save(e.id, { monthly_rate: ev.target.value === "" ? null : Number(ev.target.value) }); }} /></div>
              <div><Lbl c="原価/支払(万)" />{masked ? <div style={{ padding: "5px 0" }}><Locked /></div> : <input type="number" defaultValue={e.cost ?? ""} placeholder="未入力" style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.cost ?? "")) save(e.id, { cost: ev.target.value === "" ? null : Number(ev.target.value) }); }} />}</div>
              <div><Lbl c="粗利(万)" /><div style={{ padding: "5px 0", fontWeight: 700, fontSize: 13, color: masked ? "var(--color-ink-4)" : gross != null ? (gross >= 0 ? "#067647" : "#b42318") : "var(--color-ink-4)" }}>{masked ? <Locked /> : gross != null ? `${gross}万` : "—"}</div></div>
            </div>

            {/* 精算 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><Lbl c="清算下限(h)" /><input type="number" defaultValue={e.settle_min ?? ""} style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.settle_min ?? "")) save(e.id, { settle_min: ev.target.value === "" ? null : Number(ev.target.value) }); }} /></div>
              <div><Lbl c="清算上限(h)" /><input type="number" defaultValue={e.settle_max ?? ""} style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.settle_max ?? "")) save(e.id, { settle_max: ev.target.value === "" ? null : Number(ev.target.value) }); }} /></div>
              <div><Lbl c="当月稼働(h)" /><input type="number" defaultValue={e.work_hours ?? ""} style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.work_hours ?? "")) save(e.id, { work_hours: ev.target.value === "" ? null : Number(ev.target.value) }); }} /></div>
            </div>

            {/* 法務（回収ステータス） */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><Lbl c="契約書" /><select defaultValue={e.contract_status ?? ""} style={{ ...inp, color: collectTone(e.contract_status), fontWeight: 600 }} disabled={pending} onChange={(ev) => save(e.id, { contract_status: ev.target.value || null })}><option value="">未</option>{COLLECT.map((s) => <option key={s}>{s}</option>)}</select></div>
              <div><Lbl c="注文書" /><select defaultValue={e.po_status ?? ""} style={{ ...inp, color: collectTone(e.po_status), fontWeight: 600 }} disabled={pending} onChange={(ev) => save(e.id, { po_status: ev.target.value || null })}><option value="">未</option>{COLLECT.map((s) => <option key={s}>{s}</option>)}</select></div>
            </div>

            {/* 契約更新 */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><Lbl c="更新ステータス" /><select defaultValue={e.renewal_status ?? ""} style={inp} disabled={pending} onChange={(ev) => save(e.id, { renewal_status: ev.target.value || null })}><option value="">—</option>{RENEWAL_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
              <div><Lbl c="満了日" /><input type="date" defaultValue={dateVal(e.end_date)} style={{ ...inp, color: endSoon ? "#b45309" : undefined, fontWeight: endSoon ? 700 : 400 }} disabled={pending} onBlur={(ev) => { if (ev.target.value !== dateVal(e.end_date)) save(e.id, { end_date: ev.target.value || null }); }} /></div>
              <div><Lbl c="更新期限" /><input type="date" defaultValue={dateVal(e.renewal_due)} style={inp} disabled={pending} onBlur={(ev) => { if (ev.target.value !== dateVal(e.renewal_due)) save(e.id, { renewal_due: ev.target.value || null }); }} /></div>
            </div>
            {endSoon && <div style={{ fontSize: 11, color: "#b45309", fontWeight: 600 }}>⚠ 満了まで {d}日 — 更新対応を進めてください</div>}

            {/* 稼働状態切替 */}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: 10.5 }}>状態変更：</span>
              {STATUSES.filter((s) => s !== e.status).map((s) => (
                <button key={s} type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => setStatus(e.id, s)}>{s}</button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
