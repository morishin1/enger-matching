"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getRateChanges, recordRateChange, type RateChange } from "@/lib/actions";

type Eng = { id: string; candidate_name?: string | null; company?: string | null; job_title?: string | null; monthly_rate?: number | null };

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }) : "—");
const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)", width: "100%", boxSizing: "border-box" } as const;
const L = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 3 }}>{children}</div>;

/** 月額(万)の単価アップ履歴を見る・記録するボタン（モーダルを開く）。 */
export function RateHistoryButton({ e, canManage }: { e: Eng; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn ghost btn-xs" title="単価アップ履歴" style={{ fontSize: 10, padding: "1px 6px", whiteSpace: "nowrap" }} onClick={() => setOpen(true)}>↑ 単価履歴</button>
      {open && <RateHistoryModal e={e} canManage={canManage} onClose={() => setOpen(false)} />}
    </>
  );
}

function RateHistoryModal({ e, canManage, onClose }: { e: Eng; canManage: boolean; onClose: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<RateChange[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ new_rate: "", effective_date: today(), note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(e.monthly_rate != null ? Number(e.monthly_rate) : null);

  const load = () => { getRateChanges(e.id).then((r) => { if (r.ok) setRows(r.rows ?? []); else setLoadErr(r.error ?? "履歴の読み込みに失敗しました"); }); };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = () => {
    const n = Number(form.new_rate);
    if (form.new_rate === "" || isNaN(n)) { setErr("新しい月額(万)を入力してください"); return; }
    setErr(null);
    start(async () => {
      const res = await recordRateChange(e.id, { new_rate: n, effective_date: form.effective_date || null, note: form.note || null });
      if (!res.ok) { setErr(res.error ?? "保存に失敗しました"); return; }
      setForm({ new_rate: "", effective_date: today(), note: "" });
      setCurrent(n);
      load();
      router.refresh();
    });
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 320, padding: 20 }}>
      <div onClick={(ev) => ev.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 540, maxHeight: "88vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>単価アップ履歴</h3>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{e.candidate_name ?? "—"}{e.company ? ` / ${e.company}` : ""}{e.job_title ? ` / ${e.job_title}` : ""}</div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 8, background: "var(--color-surface-inset)", borderRadius: 10, padding: "10px 12px" }}>
          <span style={{ fontSize: 11.5, color: "var(--color-ink-4)", fontWeight: 600 }}>現在の月額</span>
          <span style={{ fontSize: 20, fontWeight: 800 }}>{current != null ? `${current}` : "—"}</span>
          <span style={{ fontSize: 12, color: "var(--color-ink-4)" }}>万</span>
        </div>

        {/* 履歴 */}
        <div>
          <L>変更履歴（新しい順）</L>
          {loadErr ? <div style={{ fontSize: 12, color: "var(--color-danger)" }}>{loadErr}</div>
            : rows == null ? <div className="muted" style={{ fontSize: 12.5 }}>読み込み中…</div>
            : rows.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>まだ単価変更の記録はありません。</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((r) => {
                  const diff = r.new_rate - (r.old_rate ?? 0);
                  const up = diff > 0, down = diff < 0;
                  const diffColor = up ? "#067647" : down ? "#b42318" : "var(--color-ink-4)";
                  return (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--color-border)", borderRadius: 8 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, minWidth: 92 }}>{fmtDate(r.effective_date)}</div>
                      <div style={{ fontSize: 12.5 }}>
                        <span style={{ color: "var(--color-ink-4)" }}>{r.old_rate != null ? `${r.old_rate}万` : "—"}</span>
                        <span style={{ margin: "0 5px", color: "var(--color-ink-4)" }}>→</span>
                        <span style={{ fontWeight: 700 }}>{r.new_rate}万</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: diffColor }}>{up ? `+${diff}` : down ? `${diff}` : "±0"}万</div>
                      {r.note && <div className="muted" style={{ fontSize: 11, marginLeft: "auto", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.note}>{r.note}</div>}
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {/* 記録フォーム（管理者・バックオフィスのみ） */}
        {canManage ? (
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <L>単価アップを記録（現在の月額を旧単価として履歴に残し、新単価に更新します）</L>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><L>新しい月額(万)</L><input style={inp} type="number" value={form.new_rate} placeholder={current != null ? `現在 ${current}` : "例: 85"} onChange={(ev) => setForm((p) => ({ ...p, new_rate: ev.target.value }))} /></div>
              <div><L>適用日</L><input style={inp} type="date" value={form.effective_date} onChange={(ev) => setForm((p) => ({ ...p, effective_date: ev.target.value }))} /></div>
            </div>
            <div><L>メモ（任意）</L><input style={inp} value={form.note} placeholder="更新交渉で +5万 など" onChange={(ev) => setForm((p) => ({ ...p, note: ev.target.value }))} /></div>
            {err && <div style={{ color: "var(--color-danger)", fontSize: 12 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn brand" disabled={pending} onClick={submit}>{pending ? "記録中…" : "単価アップを記録"}</button>
              <button type="button" className="btn ghost" onClick={onClose}>閉じる</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" className="btn ghost" onClick={onClose}>閉じる</button></div>
        )}
      </div>
    </div>
  );
}
