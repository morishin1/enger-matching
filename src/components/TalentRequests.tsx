"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTalentRequestStatus } from "@/app/portal/actions";
import type { TalentRequest } from "@/lib/engineers";

const fmtDate = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: "新規", bg: "#fef3c7", fg: "#92400e" },
  contacted: { label: "対応中", bg: "#dbeafe", fg: "#1e40af" },
  closed: { label: "完了", bg: "#dcfce7", fg: "#166534" },
};

export function TalentRequests({ rows }: { rows: TalentRequest[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const open = rows.filter((r) => r.status !== "closed");
  if (rows.length === 0) return null;

  const set = (id: string, status: "new" | "contacted" | "closed") => {
    setBusy(id);
    start(async () => { await updateTalentRequestStatus(id, status); setBusy(null); router.refresh(); });
  };

  return (
    <div className="card" style={{ borderColor: open.length ? "var(--color-brand-300)" : "var(--color-border)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" style={{ color: "var(--color-brand-700)" }}>contact_mail</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>企業からの人材リクエスト</h3>
        {open.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: "#fef3c7", color: "#92400e" }}>未対応 {open.filter((r) => r.status === "new").length}</span>}
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>企業が「話を聞きたい」を押した人材です。氏名・連絡先は dx の人材/エンジャー登録で確認し、仲介してください。</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.slice(0, 30).map((r) => {
          const st = STATUS[r.status] ?? STATUS.new;
          return (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: 10, opacity: r.status === "closed" ? 0.6 : 1 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: st.bg, color: st.fg, flex: "0 0 auto" }}>{st.label}</span>
              <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.company} <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>→ {r.label || (r.kind === "profile" ? "ENGER登録エンジニア" : "登録人材")}</span></div>
                <div className="muted" style={{ fontSize: 10.5 }}>{r.kind === "profile" ? "profiles" : "candidates"} · {fmtDate(r.created_at)}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                {r.status !== "contacted" && <button className="btn btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "contacted")}>対応中に</button>}
                {r.status !== "closed" && <button className="btn ghost btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "closed")}>完了</button>}
                {r.status === "closed" && <button className="btn ghost btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "new")}>戻す</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
