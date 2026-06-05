"use client";

// 稼働(契約)の編集ドロワー（右スライドイン）。Workbench の行クリックで開く。
//   - 編集: 人材名/企業/案件名/状態/月額/原価/区分/開始日/満了日
//   - 削除: 関連請求タスクも同時削除（管理者・バックオフィスのみ）
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEngagementFields, deleteEngagement } from "@/lib/actions";
import { AFFILIATIONS } from "@/lib/affiliation";

const STATUSES = ["予定", "稼働中", "終了"];
const dateVal = (d: any) => (d ? String(d).slice(0, 10) : "");

export function EngagementDrawer({ e, canSeeCost, canManage, onClose }: {
  e: any; canSeeCost: boolean; canManage: boolean; onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    candidate_name: e.candidate_name ?? "",
    company: e.company ?? "",
    job_title: e.job_title ?? "",
    status: e.status ?? "予定",
    monthly_rate: e.monthly_rate ?? "",
    cost: e.cost ?? "",
    affiliation: e.affiliation ?? "",
    start_date: dateVal(e.start_date),
    end_date: dateVal(e.end_date),
  });
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // マウント直後にスライドインさせるため、初期 false → 次フレームで true に
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 0);
    const h = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => { clearTimeout(t); window.removeEventListener("keydown", h); };
  }, [onClose]);

  const save = () => {
    setErr(null);
    const patch: Record<string, any> = {
      candidate_name: f.candidate_name.trim() || null,
      company: f.company.trim() || null,
      job_title: f.job_title.trim() || null,
      status: f.status,
      monthly_rate: f.monthly_rate === "" ? null : Number(f.monthly_rate),
      start_date: f.start_date || null,
      end_date: f.end_date || null,
    };
    if (canSeeCost) patch.cost = f.cost === "" ? null : Number(f.cost);
    if (canManage)  patch.affiliation = f.affiliation || null;
    start(async () => {
      const r = await updateEngagementFields(e.id, patch);
      if (!r.ok) { setErr(("error" in r ? r.error : null) || "保存に失敗しました"); return; }
      setMsg("✓ 保存しました");
      router.refresh();
      setTimeout(() => onClose(), 600);
    });
  };

  const onDelete = () => {
    if (!confirm(`「${e.candidate_name ?? "—"}${e.company ? ` / ${e.company}` : ""}」の稼働を削除しますか？\n関連する勤怠・請求タスクも削除されます。元に戻せません。`)) return;
    start(async () => {
      const r = await deleteEngagement(e.id);
      if (!r.ok) { setErr(("error" in r ? r.error : null) || "削除に失敗しました"); return; }
      router.refresh();
      onClose();
    });
  };

  const lbl = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 11, color: "var(--color-ink-4)" };
  const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: shown ? "rgba(15,36,64,.4)" : "transparent", transition: "background .18s ease-out" }}>
      <aside onClick={(ev) => ev.stopPropagation()}
        style={{
          position: "absolute", right: 0, top: 0, bottom: 0,
          width: "min(520px, 96vw)",
          background: "var(--color-surface)", boxShadow: "-12px 0 30px rgba(15,23,42,.18)",
          display: "flex", flexDirection: "column",
          transform: shown ? "translateX(0)" : "translateX(100%)",
          transition: "transform .22s cubic-bezier(.2,.7,.2,1)",
        }}
        role="dialog" aria-modal="true" aria-label="稼働を編集">
        {/* ヘッダ */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>稼働を編集</div>
            <div style={{ fontSize: 15, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.candidate_name ?? "—"}
              <span style={{ color: "var(--color-ink-4)", fontWeight: 500, fontSize: 12.5 }}>
                {e.company ? ` / ${e.company}` : ""}{e.job_title ? ` / ${e.job_title}` : ""}
              </span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>

        {/* 本体 */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1 }}>
          <label style={lbl}>人材名<input value={f.candidate_name} onChange={(ev) => setF({ ...f, candidate_name: ev.target.value })} style={inp} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={lbl}>企業<input value={f.company} onChange={(ev) => setF({ ...f, company: ev.target.value })} style={inp} /></label>
            <label style={lbl}>案件名<input value={f.job_title} onChange={(ev) => setF({ ...f, job_title: ev.target.value })} style={inp} /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={lbl}>状態
              <select value={f.status} onChange={(ev) => setF({ ...f, status: ev.target.value })} style={inp}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {canManage && (
              <label style={lbl}>所属区分
                <select value={f.affiliation} onChange={(ev) => setF({ ...f, affiliation: ev.target.value })} style={inp}>
                  <option value="">未設定</option>
                  {AFFILIATIONS.map((a) => <option key={a.code} value={a.code}>{a.code}（{a.label}）</option>)}
                </select>
              </label>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={lbl}>月額（万）<input type="number" value={f.monthly_rate} onChange={(ev) => setF({ ...f, monthly_rate: ev.target.value })} style={inp} /></label>
            {canSeeCost && <label style={lbl}>原価（万）<input type="number" value={f.cost} onChange={(ev) => setF({ ...f, cost: ev.target.value })} style={inp} /></label>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={lbl}>開始日<input type="date" value={f.start_date} onChange={(ev) => setF({ ...f, start_date: ev.target.value })} style={inp} /></label>
            <label style={lbl}>満了日<input type="date" value={f.end_date} onChange={(ev) => setF({ ...f, end_date: ev.target.value })} style={inp} /></label>
          </div>
          {err && <div style={{ fontSize: 12, color: "var(--color-danger)", background: "#fdecef", border: "1px solid #f6c9d2", borderRadius: 8, padding: "8px 11px" }}>{err}</div>}
          {msg && <div style={{ fontSize: 12, color: "#067647", background: "#e7f7ee", border: "1px solid #bfe3cc", borderRadius: 8, padding: "8px 11px" }}>{msg}</div>}
        </div>

        {/* フッタ：削除（左）・キャンセル＆保存（右） */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", background: "var(--color-surface-soft)" }}>
          {canManage ? (
            <button type="button" className="btn ghost" disabled={pending} onClick={onDelete} style={{ color: "var(--color-danger)" }} title="この稼働を削除（元に戻せません）">
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-3px" }}>delete</span>
              削除
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>キャンセル</button>
            <button type="button" className="btn brand" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存"}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
