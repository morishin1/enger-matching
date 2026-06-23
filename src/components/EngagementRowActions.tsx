"use client";

// 稼働(契約)の編集モーダル＋削除ボタン。契約管理タブの各行から起動。
//   - 編集: 人材名/企業/案件名/状態/月額/原価/区分/開始日/満了日 をまとめて編集
//   - 削除: 確認のうえ稼働と関連請求タスクを削除（管理者・バックオフィスのみ）
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { updateEngagementFields, deleteEngagement } from "@/lib/actions";
import { AFFILIATIONS } from "@/lib/affiliation";

const STATUSES = ["予定", "稼働中", "終了"];
const dateVal = (d: any) => (d ? String(d).slice(0, 10) : "");

export function EngagementRowActions({ e, canManage, canSeeCost }: { e: any; canManage: boolean; canSeeCost: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      <button type="button" className="btn ghost btn-xs" title="この稼働を編集" onClick={() => setOpen(true)}>
        <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-2px" }}>edit</span>
      </button>
      {canManage && <DeleteButton e={e} />}
      {open && <EditModal e={e} canSeeCost={canSeeCost} canManage={canManage} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeleteButton({ e }: { e: any }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const onDelete = () => {
    if (!confirm(`「${e.candidate_name ?? "—"}${e.company ? ` / ${e.company}` : ""}」の稼働を削除しますか？\n関連する勤怠・請求タスクも削除されます。元に戻せません。`)) return;
    start(async () => {
      const r = await deleteEngagement(e.id);
      if (!r.ok) { toast(("error" in r ? r.error : null) || "削除に失敗しました", "error"); return; }
      router.refresh();
    });
  };
  return (
    <button type="button" className="btn ghost btn-xs" title="この稼働を削除（元に戻せません）" disabled={pending} onClick={onDelete} style={{ color: "var(--color-danger)" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: "-2px" }}>delete</span>
    </button>
  );
}

function EditModal({ e, canSeeCost, canManage, onClose }: { e: any; canSeeCost: boolean; canManage: boolean; onClose: () => void }) {
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

  useEffect(() => {
    const h = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
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
    if (canManage) patch.affiliation = f.affiliation || null;
    start(async () => {
      const r = await updateEngagementFields(e.id, patch);
      if (!r.ok) { setErr(("error" in r ? r.error : null) || "保存に失敗しました"); return; }
      router.refresh();
      onClose();
    });
  };

  const lbl = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 11, color: "var(--color-ink-4)" };
  const inp = { fontFamily: "inherit", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,36,64,.5)", display: "grid", placeItems: "center", padding: 20, overflowY: "auto" }}>
      <div onClick={(ev) => ev.stopPropagation()} className="card" style={{ width: "min(560px, 96vw)", padding: 0, background: "var(--color-surface)" }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--color-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>稼働を編集</div>
          <button type="button" onClick={onClose} className="btn ghost" aria-label="閉じる" style={{ fontSize: 18, lineHeight: 1, padding: "4px 10px" }}>×</button>
        </div>
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
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
        </div>
        <div style={{ padding: "12px 22px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>キャンセル</button>
          <button type="button" className="btn brand" disabled={pending} onClick={save}>{pending ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}
