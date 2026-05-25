"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import type { BillingTask } from "@/lib/billing";
import { upsertBillingTask, uploadBillingFile } from "@/app/billing/actions";

const inp = { fontFamily: "inherit", fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%" } as const;

const MAX_MB = 10; // 1ファイルの最大サイズ（一般的なサイズ）
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.xls";

function within(h: number | null, min: number | null, max: number | null) {
  if (h == null) return null;
  if (min != null && h < min) return "under";
  if (max != null && h > max) return "over";
  return "ok";
}

function TaskCard({ t, onChanged }: { t: BillingTask; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [hours, setHours] = useState(t.attendance_hours ?? "");
  const [amount, setAmount] = useState(t.invoice_amount ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const attRef = useRef<HTMLInputElement>(null);
  const invRef = useRef<HTMLInputElement>(null);

  const save = (patch: Record<string, any>) => start(async () => { await upsertBillingTask(t.engagement_id, t.period, patch); onChanged(); });
  const upload = (kind: "attendance" | "invoice", file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) { setMsg({ ok: false, text: `ファイルが大きすぎます（最大${MAX_MB}MB）。現在 ${(file.size / 1024 / 1024).toFixed(1)}MB` }); return; }
    setMsg({ ok: true, text: kind === "attendance" ? `「${file.name}」を解析中…（AIが稼働時間を計算します）` : `「${file.name}」をアップロード中…` });
    start(async () => {
      const fd = new FormData(); fd.set("engagement_id", t.engagement_id); fd.set("period", t.period); fd.set("kind", kind); fd.set("file", file);
      const r = await uploadBillingFile(fd);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "アップロードに失敗しました" }); onChanged(); return; }
      if (kind === "attendance") {
        if (r.hours != null) { setHours(r.hours); setMsg({ ok: true, text: `✓ 勤怠表を解析しました。AI算出の稼働時間：${r.hours}h（必要なら修正できます）` }); }
        else setMsg({ ok: true, text: `✓ 勤怠表を添付しました（${file.name}）。${r.aiError ? "稼働時間の自動計算に失敗：" + r.aiError : r.aiNote ?? "稼働時間は手入力してください。"}` });
      } else {
        setMsg({ ok: true, text: `✓ 請求書を添付しました（${file.name}）` });
      }
      onChanged();
    });
  };

  const attOk = t.attendance_status === "確認済";
  const invOk = t.invoice_status === "発行済";
  const w = within(typeof hours === "number" ? hours : Number(hours), t.settle_min, t.settle_max);

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, opacity: pending ? 0.6 : 1, borderLeft: `3px solid ${t.done ? "#1aa260" : "#d98a2b"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.candidate_name ?? "—"}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{t.company ?? ""}{t.job_title ? ` / ${t.job_title}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: attOk ? "#e7f3ea" : "#fdecef", color: attOk ? "#1aa260" : "#d23f57" }}>勤怠 {attOk ? "✓" : "未"}</span>
          <span className="pill" style={{ fontSize: 10, borderColor: "transparent", background: invOk ? "#e7f3ea" : "#fdecef", color: invOk ? "#1aa260" : "#d23f57" }}>請求 {invOk ? "✓" : "未"}</span>
        </div>
      </div>

      {/* 勤怠 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <b style={{ fontSize: 12 }}>🕒 勤怠チェック</b>
          <button className="btn ghost btn-xs" disabled={pending} onClick={() => save({ attendance_status: attOk ? "未" : "確認済" })}>{attOk ? "未確認に戻す" : "確認済にする"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} onBlur={() => save({ attendance_hours: hours === "" ? null : Number(hours) })} placeholder="稼働h" style={{ ...inp, width: 90 }} />
          <span className="muted" style={{ fontSize: 11 }}>清算 {t.settle_min ?? "—"}〜{t.settle_max ?? "—"}h</span>
          {w === "over" && <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700 }}>超過</span>}
          {w === "under" && <span style={{ fontSize: 11, color: "#b42318", fontWeight: 700 }}>不足</span>}
          {w === "ok" && <span style={{ fontSize: 11, color: "#1aa260", fontWeight: 700 }}>範囲内</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={attRef} type="file" accept={ACCEPT} hidden onChange={(e) => { if (e.target.files?.[0]) upload("attendance", e.target.files[0]); e.target.value = ""; }} />
          <button className="btn brand" style={{ fontSize: 12.5 }} disabled={pending} onClick={() => attRef.current?.click()}>📎 {pending ? "アップロード中…" : t.attendance_file ? "勤怠表を差し替え" : "勤怠表をアップロード"}</button>
          {t.attendance_file && <a href={t.attendance_file} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 12.5, textDecoration: "none" }}>📄 添付を見る</a>}
          <span className="muted" style={{ fontSize: 10 }}>最大{MAX_MB}MB（PDF/画像/Excel/CSV）</span>
        </div>
      </div>

      {/* 請求 */}
      <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <b style={{ fontSize: 12 }}>📑 請求書発行</b>
          <button className="btn ghost btn-xs" disabled={pending} onClick={() => save({ invoice_status: invOk ? "未" : "発行済" })}>{invOk ? "未発行に戻す" : "発行済にする"}</button>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => save({ invoice_amount: amount === "" ? null : Number(amount) })} placeholder="請求額" style={{ ...inp, width: 120 }} />
          <span className="muted" style={{ fontSize: 11 }}>月額 {t.monthly_rate != null ? `${t.monthly_rate}万` : "—"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input ref={invRef} type="file" accept={ACCEPT} hidden onChange={(e) => { if (e.target.files?.[0]) upload("invoice", e.target.files[0]); e.target.value = ""; }} />
          <button className="btn brand" style={{ fontSize: 12.5 }} disabled={pending} onClick={() => invRef.current?.click()}>📎 {pending ? "アップロード中…" : t.invoice_file ? "請求書を差し替え" : "請求書をアップロード"}</button>
          {t.invoice_file && <a href={t.invoice_file} target="_blank" rel="noreferrer" className="btn" style={{ fontSize: 12.5, textDecoration: "none" }}>📄 添付を見る</a>}
          <span className="muted" style={{ fontSize: 10 }}>最大{MAX_MB}MB（PDF/画像/Excel/CSV）</span>
        </div>
      </div>

      {msg && <div style={{ fontSize: 11.5, fontWeight: 600, padding: "7px 10px", borderRadius: 8, background: msg.ok ? "#e7f3ea" : "#fdecef", color: msg.ok ? "#067647" : "#b42318" }}>{msg.text}</div>}

      {t.done && <div style={{ fontSize: 11, color: "#1aa260", fontWeight: 700 }}>✓ 当月の処理完了</div>}
    </div>
  );
}

export function BillingClient({ tasks, period }: { tasks: BillingTask[]; period: string }) {
  const router = useRouter();
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState("");

  const onChanged = () => router.refresh();
  const filtered = tasks.filter((t) =>
    (showDone || !t.done) &&
    (!q.trim() || (t.candidate_name ?? "").includes(q.trim()) || (t.company ?? "").includes(q.trim()))
  );

  const setMonth = (delta: number) => {
    const [y, m] = period.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    router.push(`/billing?period=${d.toISOString().slice(0, 7)}`);
  };

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button className="btn ghost btn-xs" onClick={() => setMonth(-1)}>← 前月</button>
          <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90, textAlign: "center" }}>{period}</span>
          <button className="btn ghost btn-xs" onClick={() => setMonth(1)}>翌月 →</button>
        </div>
        <div className="tbl-search" style={{ width: 220, flex: "0 0 220px" }}><input placeholder="人材・企業で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />完了も表示
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
          {tasks.length === 0 ? "対象の稼働がありません。稼働管理で稼働中の契約を登録してください。" : "未処理のタスクはありません 🎉 すべて完了しています。"}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
          {filtered.map((t) => <TaskCard key={t.engagement_id} t={t} onChanged={onChanged} />)}
        </div>
      )}
    </>
  );
}
