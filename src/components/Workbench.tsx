"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEngagementStatus, updateEngagementFields } from "@/lib/actions";
import { upsertBillingTask, uploadBillingFile } from "@/app/billing/actions";
import { EngagementTools } from "./EngagementTools";
import { AFFILIATIONS, affiliationShort } from "@/lib/affiliation";
import type { Role } from "@/lib/roles";

const STATUSES = ["予定", "稼働中", "終了"] as const;
const COLLECT = ["未", "送付済", "回収済"];
const MAX_MB = 10;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls";
const TONE: Record<string, { bg: string; fg: string }> = {
  予定: { bg: "#fef6e0", fg: "#9a7b12" }, 稼働中: { bg: "#e7f3ea", fg: "#1aa260" }, 終了: { bg: "#eef0f3", fg: "#5a6573" },
};
const collectTone = (s?: string | null) => (s === "回収済" ? "#1aa260" : s === "送付済" ? "#9a7b12" : "#d23f57");
const DAY = 86400000;
const daysUntil = (d?: string | null) => (d ? Math.floor((new Date(d).getTime() - Date.now()) / DAY) : null);
const dateVal = (d: string | null) => (d ? String(d).slice(0, 10) : "");
const within = (h: number | null, min: number | null, max: number | null) => {
  if (h == null || isNaN(h)) return null;
  if (min != null && h < min) return "under";
  if (max != null && h > max) return "over";
  return "ok";
};

const inp = { fontFamily: "inherit", fontSize: 12, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%", boxSizing: "border-box" } as const;
const Lbl = ({ c }: { c: string }) => <div style={{ fontSize: 10, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 2 }}>{c}</div>;
const Locked = () => <span title="閲覧権限がありません" style={{ fontSize: 11, color: "var(--color-ink-4)" }}>🔒</span>;

type Bill = { attendance_status?: string; attendance_hours?: number | null; attendance_file?: string | null; invoice_status?: string; invoice_amount?: number | null; invoice_file?: string | null };
type Eng = Record<string, any> & { id: string; bill?: Bill; _maskMargin?: boolean };

/** 勤怠・請求の操作（行/カード共通）。勤怠表アップロードでAIが時間を自動計算。 */
function useBilling(engId: string, period: string, onChanged: () => void) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveBill = (patch: Record<string, any>) => start(async () => { await upsertBillingTask(engId, period, patch); onChanged(); });
  const upload = (kind: "attendance" | "invoice", file: File, setHours?: (n: number) => void) => {
    if (file.size > MAX_MB * 1024 * 1024) { setMsg({ ok: false, text: `最大${MAX_MB}MB` }); return; }
    setMsg({ ok: true, text: kind === "attendance" ? "解析中…(AIが稼働時間を計算)" : "アップロード中…" });
    start(async () => {
      const fd = new FormData(); fd.set("engagement_id", engId); fd.set("period", period); fd.set("kind", kind); fd.set("file", file);
      const r = await uploadBillingFile(fd);
      if (!r.ok) setMsg({ ok: false, text: r.error ?? "失敗しました" });
      else if (kind === "attendance") {
        if (r.hours != null) { setHours?.(r.hours); setMsg({ ok: true, text: `✓ AI算出 ${r.hours}h` }); }
        else setMsg({ ok: true, text: r.aiError ? "添付済(自動計算失敗)" : (r.aiNote ?? "添付しました") });
      } else setMsg({ ok: true, text: "✓ 請求書を添付" });
      onChanged();
    });
  };
  return { pending, msg, saveBill, upload };
}

function AttCell({ e, period, onChanged }: { e: Eng; period: string; onChanged: () => void }) {
  const b = e.bill ?? {};
  const [hours, setHours] = useState<number | "">(b.attendance_hours ?? "");
  const { pending, msg, saveBill, upload } = useBilling(e.id, period, onChanged);
  const ref = useRef<HTMLInputElement>(null);
  const w = within(typeof hours === "number" ? hours : (hours === "" ? null : Number(hours)), e.settle_min, e.settle_max);
  const attOk = b.attendance_status === "確認済";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input type="number" value={hours} disabled={pending} placeholder="h" style={{ ...inp, width: 56 }} onChange={(ev) => setHours(ev.target.value === "" ? "" : Number(ev.target.value))} onBlur={() => saveBill({ attendance_hours: hours === "" ? null : Number(hours) })} />
        {w === "over" && <span style={{ fontSize: 10, color: "#b45309", fontWeight: 700 }}>超</span>}
        {w === "under" && <span style={{ fontSize: 10, color: "#b42318", fontWeight: 700 }}>不足</span>}
        {w === "ok" && <span style={{ fontSize: 10, color: "#1aa260", fontWeight: 700 }}>範囲内</span>}
        <button type="button" className="btn ghost btn-xs" disabled={pending} title="確認済/未" onClick={() => saveBill({ attendance_status: attOk ? "未" : "確認済" })} style={{ color: attOk ? "#1aa260" : "var(--color-ink-4)" }}>{attOk ? "✓済" : "未"}</button>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(ev) => { if (ev.target.files?.[0]) upload("attendance", ev.target.files[0], (n) => setHours(n)); ev.target.value = ""; }} />
        <button type="button" className="btn btn-xs" disabled={pending} onClick={() => ref.current?.click()} style={{ fontSize: 11 }}>📎勤怠表</button>
        {b.attendance_file && <a href={b.attendance_file} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>📄</a>}
      </div>
      {msg && <div style={{ fontSize: 10, color: msg.ok ? "#067647" : "#b42318" }}>{msg.text}</div>}
    </div>
  );
}

function InvCell({ e, period, onChanged }: { e: Eng; period: string; onChanged: () => void }) {
  const b = e.bill ?? {};
  const [amount, setAmount] = useState<number | "">(b.invoice_amount ?? "");
  const { pending, msg, saveBill, upload } = useBilling(e.id, period, onChanged);
  const ref = useRef<HTMLInputElement>(null);
  const invOk = b.invoice_status === "発行済";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input type="number" value={amount} disabled={pending} placeholder="請求額(万)" title="請求額（万円単位）" style={{ ...inp, width: 78 }} onChange={(ev) => setAmount(ev.target.value === "" ? "" : Number(ev.target.value))} onBlur={() => saveBill({ invoice_amount: amount === "" ? null : Number(amount) })} />
        <button type="button" className="btn ghost btn-xs" disabled={pending} title="発行済/未" onClick={() => saveBill({ invoice_status: invOk ? "未" : "発行済" })} style={{ color: invOk ? "#1aa260" : "var(--color-ink-4)" }}>{invOk ? "✓発行" : "未"}</button>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input ref={ref} type="file" accept={ACCEPT} hidden onChange={(ev) => { if (ev.target.files?.[0]) upload("invoice", ev.target.files[0]); ev.target.value = ""; }} />
        <button type="button" className="btn btn-xs" disabled={pending} onClick={() => ref.current?.click()} style={{ fontSize: 11 }}>📎請求書</button>
        {b.invoice_file && <a href={b.invoice_file} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>📄</a>}
      </div>
      {msg && <div style={{ fontSize: 10, color: msg.ok ? "#067647" : "#b42318" }}>{msg.text}</div>}
    </div>
  );
}

function AffSelect({ e, isAdmin, onSave }: { e: Eng; isAdmin: boolean; onSave: (v: string | null) => void }) {
  if (!isAdmin) return <span className="tag" style={{ fontSize: 10.5 }}>{affiliationShort(e.affiliation)}</span>;
  return (
    <select defaultValue={affiliationShort(e.affiliation) === "未設定" ? "" : affiliationShort(e.affiliation)} style={{ ...inp, width: 64 }} onChange={(ev) => onSave(ev.target.value || null)}>
      <option value="">未</option>
      {AFFILIATIONS.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
    </select>
  );
}

function Row({ e, role, period, onChanged, done }: { e: Eng; role: Role; period: string; onChanged: () => void; done?: boolean }) {
  const [pending, start] = useTransition();
  const isAdmin = role === "admin";
  const masked = e._maskMargin;
  const rate = Number(e.monthly_rate), cost = Number(e.cost);
  const gross = (!masked && !isNaN(rate) && !isNaN(cost) && e.cost != null) ? Math.round(rate - cost) : null;
  const tone = TONE[e.status] ?? TONE["予定"];
  const save = (patch: Record<string, any>) => start(async () => { await updateEngagementFields(e.id, patch); onChanged(); });
  const setStatus = (s: string) => start(async () => { await updateEngagementStatus(e.id, s); onChanged(); });
  const td = { padding: "7px 8px", borderBottom: "1px solid var(--color-border)", verticalAlign: "top" } as const;
  return (
    <tr style={{ opacity: pending ? 0.6 : 1, background: done ? "var(--color-surface-soft)" : undefined }}>
      <td style={td}>
        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{e.candidate_name ?? "—"}{done && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#067647", background: "#e7f3ea", borderRadius: 6, padding: "1px 6px" }}>✓済</span>}</div>
        <div className="muted" style={{ fontSize: 10.5 }}>{e.company ?? ""}{e.job_title ? ` / ${e.job_title}` : ""}</div>
      </td>
      <td style={td}><AffSelect e={e} isAdmin={isAdmin} onSave={(v) => save({ affiliation: v })} /></td>
      <td style={td}><input type="number" defaultValue={e.monthly_rate ?? ""} placeholder="万" title="月額（万円）" style={{ ...inp, width: 62 }} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.monthly_rate ?? "")) save({ monthly_rate: ev.target.value === "" ? null : Number(ev.target.value) }); }} /></td>
      <td style={td}>{masked ? <Locked /> : <input type="number" defaultValue={e.cost ?? ""} placeholder="万" title="原価（万円）" style={{ ...inp, width: 62 }} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.cost ?? "")) save({ cost: ev.target.value === "" ? null : Number(ev.target.value) }); }} />}</td>
      <td style={{ ...td, fontWeight: 700, color: masked ? "var(--color-ink-4)" : gross != null ? (gross >= 0 ? "#067647" : "#b42318") : "var(--color-ink-4)" }}>{masked ? <Locked /> : gross != null ? `${gross}` : "—"}</td>
      <td style={td}>
        <select value={e.status ?? "予定"} disabled={pending} onChange={(ev) => setStatus(ev.target.value)} style={{ ...inp, width: 74, background: tone.bg, color: tone.fg, fontWeight: 700 }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td style={td}><AttCell e={e} period={period} onChanged={onChanged} /></td>
      <td style={td}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <select defaultValue={e.contract_status ?? ""} style={{ ...inp, width: 78, color: collectTone(e.contract_status), fontWeight: 600 }} disabled={pending} onChange={(ev) => save({ contract_status: ev.target.value || null })}><option value="">契約書:未</option>{COLLECT.map((s) => <option key={s} value={s}>契約{s}</option>)}</select>
          <select defaultValue={e.po_status ?? ""} style={{ ...inp, width: 78, color: collectTone(e.po_status), fontWeight: 600 }} disabled={pending} onChange={(ev) => save({ po_status: ev.target.value || null })}><option value="">注文書:未</option>{COLLECT.map((s) => <option key={s} value={s}>注文{s}</option>)}</select>
        </div>
      </td>
      <td style={td}><InvCell e={e} period={period} onChanged={onChanged} /></td>
      <td style={td}><input type="date" defaultValue={dateVal(e.end_date)} style={{ ...inp, width: 124 }} disabled={pending} onBlur={(ev) => { if (ev.target.value !== dateVal(e.end_date)) save({ end_date: ev.target.value || null }); }} /></td>
    </tr>
  );
}

/** 当月の処理が完了か：請求書=発行済 かつ 注文書=回収済。 */
const isDone = (e: Eng) => (e.bill?.invoice_status === "発行済") && (e.po_status === "回収済");

export function Workbench({ rows, role = "admin", period, canManage, agentScoped }: { rows: any[]; role?: Role; period: string; canManage: boolean; agentScoped?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "card" | "graph">("list");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const onChanged = () => router.refresh();

  const setMonth = (delta: number) => {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    router.push(`/progress?period=${d.toISOString().slice(0, 7)}`);
  };

  const searched = useMemo(() => rows.filter((e) => !q.trim() || (e.candidate_name ?? "").includes(q.trim()) || (e.company ?? "").includes(q.trim()) || (e.job_title ?? "").includes(q.trim())), [rows, q]);
  const doneCount = useMemo(() => searched.filter(isDone).length, [searched]);
  // 済（請求書＋注文書 揃い）は既定で非表示。トグルで一覧表示。
  const visible = showDone ? searched : searched.filter((e) => !isDone(e));

  const tabBtn = (id: "list" | "card" | "graph", label: string) => (
    <button onClick={() => setView(id)} style={{ padding: "6px 14px", borderRadius: 99, border: 0, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", background: view === id ? "var(--color-surface)" : "transparent", color: view === id ? "var(--color-ink)" : "var(--color-ink-3)", boxShadow: view === id ? "0 1px 2px rgba(15,23,42,0.06)" : "none" }}>{label}</button>
  );
  const th = { padding: "8px", textAlign: "left", fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700, whiteSpace: "nowrap", borderBottom: "2px solid var(--color-border)" } as const;

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--color-surface-inset)", borderRadius: 99 }}>{tabBtn("list", "📋 リスト")}{tabBtn("card", "🗂 カード")}{tabBtn("graph", "📊 推移")}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button className="btn ghost btn-xs" onClick={() => setMonth(-1)}>← 前月</button>
          <span style={{ fontWeight: 700, fontSize: 13.5, minWidth: 78, textAlign: "center" }}>{period}</span>
          <button className="btn ghost btn-xs" onClick={() => setMonth(1)}>翌月 →</button>
          <span className="muted" style={{ fontSize: 11 }}>の勤怠・請求</span>
        </div>
        <div className="tbl-search" style={{ width: 180, flex: "0 0 180px" }}><input placeholder="人材・企業で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {view !== "graph" && (
          <button onClick={() => setShowDone((v) => !v)} title="請求書＋注文書が揃った稼働" style={{ padding: "6px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${showDone ? "#1aa260" : "var(--color-border-strong)"}`, background: showDone ? "#e7f3ea" : "var(--color-surface)", color: showDone ? "#067647" : "var(--color-ink-3)" }}>✓ 済 {doneCount}{showDone ? "（表示中）" : "（非表示）"}</button>
        )}
        {agentScoped && <span className="muted" style={{ fontSize: 11 }}>自分の担当のみ</span>}
        <div style={{ marginLeft: "auto" }}>{canManage && <EngagementTools rows={rows} />}</div>
      </div>

      {view === "graph" ? (
        <GraphView rows={rows} period={period} role={role} />
      ) : visible.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
          {searched.length > 0 && doneCount > 0 ? <>未処理の稼働はありません 🎉 「✓ 済 {doneCount}」で完了分を表示できます。</> : <>対象の稼働がありません。提案管理で成約 →「稼働化」、または「＋新規追加」で登録してください。</>}
        </div>
      ) : view === "list" ? (
        <div className="card flush" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead>
              <tr>
                <th style={th}>人材 / 企業・案件</th><th style={th}>区分</th><th style={th}>月額(万)</th><th style={th}>原価(万)</th><th style={th}>粗利(万)</th><th style={th}>状態</th>
                <th style={th}>当月勤怠({period})</th><th style={th}>契約書/注文書</th><th style={th}>請求(万・{period})</th><th style={th}>満了日</th>
              </tr>
            </thead>
            <tbody>{visible.map((e) => <Row key={e.id} e={e} role={role} period={period} onChanged={onChanged} done={isDone(e)} />)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {visible.map((e) => <Card key={e.id} e={e} role={role} period={period} onChanged={onChanged} done={isDone(e)} />)}
        </div>
      )}
    </>
  );
}

/** 直近3ヶ月の月次売上(稼働中・予定の月額合計)を棒グラフで表示。 */
function GraphView({ rows, period, role }: { rows: Eng[]; period: string; role: Role }) {
  const [y, m] = period.split("-").map(Number);
  const months = [-2, -1, 0].map((d) => {
    const dt = new Date(y, m - 1 + d, 1);
    return { y: dt.getFullYear(), m: dt.getMonth(), label: `${dt.getFullYear()}/${dt.getMonth() + 1}` };
  });
  const inMonth = (e: Eng, my: number, mm: number) => {
    if (e.status === "終了" && !e.end_date) return false;
    const ms = new Date(my, mm, 1).getTime();
    const me = new Date(my, mm + 1, 0).getTime();
    const s = e.start_date ? new Date(e.start_date).getTime() : -Infinity;
    const en = e.end_date ? new Date(e.end_date).getTime() : Infinity;
    return s <= me && en >= ms;
  };
  const data = months.map((mo) => {
    const active = rows.filter((e) => inMonth(e, mo.y, mo.m));
    const sales = active.reduce((a, e) => a + (Number(e.monthly_rate) || 0), 0);
    const gross = active.filter((e) => !e._maskMargin && e.cost != null).reduce((a, e) => a + ((Number(e.monthly_rate) || 0) - (Number(e.cost) || 0)), 0);
    return { ...mo, sales, gross, count: active.length };
  });
  const max = Math.max(1, ...data.map((d) => d.sales));

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📊 月次売上の推移（直近3ヶ月）</h3>
        <span className="muted" style={{ fontSize: 11 }}>各月に稼働している契約の月額合計（万）</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 28, height: 220, padding: "16px 8px 0", justifyContent: "center" }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 110 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-brand-700,#0b5cab)" }}>{d.sales.toLocaleString("ja-JP")}<span style={{ fontSize: 10, fontWeight: 600 }}>万</span></div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 150 }}>
              <div title={`売上 ${d.sales}万`} style={{ width: 38, height: `${Math.max(d.sales > 0 ? 6 : 0, Math.round((d.sales / max) * 100))}%`, background: "linear-gradient(180deg,#38BDF8,#0095D9)", borderRadius: "5px 5px 0 0" }} />
              {role === "admin" && <div title={`粗利 ${d.gross}万`} style={{ width: 38, height: `${Math.max(d.gross > 0 ? 4 : 0, Math.round((d.gross / max) * 100))}%`, background: "linear-gradient(180deg,#86efac,#22c55e)", borderRadius: "5px 5px 0 0" }} />}
            </div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{d.label}{d.label.endsWith(`/${m}`) ? "（当月）" : ""}</div>
            <div className="muted" style={{ fontSize: 10.5 }}>{d.count}名稼働</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, fontSize: 11, color: "var(--color-ink-4)" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#0095D9", borderRadius: 2, marginRight: 4 }} />売上(万)</span>
        {role === "admin" && <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#22c55e", borderRadius: 2, marginRight: 4 }} />粗利(万)</span>}
      </div>
    </div>
  );
}

function Card({ e, role, period, onChanged, done }: { e: Eng; role: Role; period: string; onChanged: () => void; done?: boolean }) {
  const [pending, start] = useTransition();
  const isAdmin = role === "admin";
  const masked = e._maskMargin;
  const rate = Number(e.monthly_rate), cost = Number(e.cost);
  const gross = (!masked && !isNaN(rate) && !isNaN(cost) && e.cost != null) ? Math.round(rate - cost) : null;
  const tone = TONE[e.status] ?? TONE["予定"];
  const d = daysUntil(e.end_date);
  const endSoon = d != null && d >= 0 && d <= 31;
  const save = (patch: Record<string, any>) => start(async () => { await updateEngagementFields(e.id, patch); onChanged(); });
  const setStatus = (s: string) => start(async () => { await updateEngagementStatus(e.id, s); onChanged(); });
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, opacity: pending ? 0.6 : 1, borderLeft: done ? "3px solid #1aa260" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{e.candidate_name ?? "—"}{done && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#067647", background: "#e7f3ea", borderRadius: 6, padding: "1px 6px" }}>✓済</span>}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{e.company ?? ""}{e.job_title ? ` / ${e.job_title}` : ""}</div>
        </div>
        <span style={{ padding: "3px 9px", borderRadius: 99, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{e.status}</span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Lbl c="区分" /><AffSelect e={e} isAdmin={isAdmin} onSave={(v) => save({ affiliation: v })} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>{STATUSES.filter((s) => s !== e.status).map((s) => <button key={s} type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => setStatus(s)}>{s}</button>)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div><Lbl c="月額(万)" /><input type="number" defaultValue={e.monthly_rate ?? ""} style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.monthly_rate ?? "")) save({ monthly_rate: ev.target.value === "" ? null : Number(ev.target.value) }); }} /></div>
        <div><Lbl c="原価(万)" />{masked ? <div style={{ padding: "5px 0" }}><Locked /></div> : <input type="number" defaultValue={e.cost ?? ""} placeholder="未入力" style={inp} disabled={pending} onBlur={(ev) => { if (String(ev.target.value) !== String(e.cost ?? "")) save({ cost: ev.target.value === "" ? null : Number(ev.target.value) }); }} />}</div>
        <div><Lbl c="粗利(万)" /><div style={{ padding: "5px 0", fontWeight: 700, fontSize: 13, color: masked ? "var(--color-ink-4)" : gross != null ? (gross >= 0 ? "#067647" : "#b42318") : "var(--color-ink-4)" }}>{masked ? <Locked /> : gross != null ? `${gross}万` : "—"}</div></div>
      </div>
      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 8 }}>
        <Lbl c={`当月勤怠（${period}）`} /><AttCell e={e} period={period} onChanged={onChanged} />
      </div>
      <div><Lbl c={`請求（${period}）`} /><InvCell e={e} period={period} onChanged={onChanged} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><Lbl c="契約書" /><select defaultValue={e.contract_status ?? ""} style={{ ...inp, color: collectTone(e.contract_status), fontWeight: 600 }} disabled={pending} onChange={(ev) => save({ contract_status: ev.target.value || null })}><option value="">未</option>{COLLECT.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><Lbl c="注文書" /><select defaultValue={e.po_status ?? ""} style={{ ...inp, color: collectTone(e.po_status), fontWeight: 600 }} disabled={pending} onChange={(ev) => save({ po_status: ev.target.value || null })}><option value="">未</option>{COLLECT.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <div><Lbl c="満了日" /><input type="date" defaultValue={dateVal(e.end_date)} style={{ ...inp, color: endSoon ? "#b45309" : undefined, fontWeight: endSoon ? 700 : 400 }} disabled={pending} onBlur={(ev) => { if (ev.target.value !== dateVal(e.end_date)) save({ end_date: ev.target.value || null }); }} />{endSoon && <div style={{ fontSize: 11, color: "#b45309", fontWeight: 600, marginTop: 4 }}>⚠ 満了まで {d}日</div>}</div>
    </div>
  );
}
