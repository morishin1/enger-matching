"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContactStatus } from "@/app/inbox/actions";

export type ContactMsg = {
  id: string; company: string | null; name: string | null; email: string | null; phone: string | null;
  topic: string | null; role: string | null; message: string | null; source: string | null;
  status: string; created_at: string;
};

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: "新規", bg: "#fef3c7", fg: "#92400e" },
  inprogress: { label: "対応中", bg: "#dbeafe", fg: "#1e40af" },
  done: { label: "完了", bg: "#dcfce7", fg: "#166534" },
};
const fmt = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function InboxClient({ rows }: { rows: ContactMsg[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [busy, setBusy] = useState<string | null>(null);

  const set = (id: string, status: "new" | "inprogress" | "done") => {
    setBusy(id);
    start(async () => { await updateContactStatus(id, status); setBusy(null); router.refresh(); });
  };

  const shown = filter === "open" ? rows.filter((r) => r.status !== "done") : rows;
  const newCount = rows.filter((r) => r.status === "new").length;

  if (rows.length === 0) {
    return <div className="card" style={{ fontSize: 13, color: "var(--color-ink-3)" }}>お問い合わせはまだありません。enger.jp のお問い合わせフォーム送信がここに届きます。</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", background: "#eef2f7", borderRadius: 10, padding: 3, gap: 2 }}>
          <button onClick={() => setFilter("open")} className="btn btn-xs" style={{ background: filter === "open" ? "var(--color-brand-700)" : "transparent", color: filter === "open" ? "#fff" : "var(--color-ink-3)", border: "none" }}>未完了</button>
          <button onClick={() => setFilter("all")} className="btn btn-xs" style={{ background: filter === "all" ? "var(--color-brand-700)" : "transparent", color: filter === "all" ? "#fff" : "var(--color-ink-3)", border: "none" }}>すべて</button>
        </div>
        {newCount > 0 && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "#fef3c7", color: "#92400e" }}>新規 {newCount}</span>}
        <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>{shown.length} 件</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((r) => {
          const st = STATUS[r.status] ?? STATUS.new;
          return (
            <div key={r.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 8, opacity: r.status === "done" ? 0.7 : 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99, background: st.bg, color: st.fg }}>{st.label}</span>
                {r.topic && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-brand-700)" }}>{r.topic}</span>}
                <span style={{ fontSize: 14, fontWeight: 700 }}>{r.company || r.name || "（無題）"}</span>
                {r.company && r.name && <span className="muted" style={{ fontSize: 12 }}>{r.name}</span>}
                <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{r.source || "Webフォーム"} · {fmt(r.created_at)}</span>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--color-ink-2)" }}>
                {r.email && <a href={`mailto:${r.email}`} style={{ color: "var(--color-brand-700)" }}>✉ {r.email}</a>}
                {r.phone && <span>☎ {r.phone}</span>}
                {r.role && <span>職種: {r.role}</span>}
              </div>
              {r.message && <div style={{ fontSize: 13, color: "var(--color-ink-2)", whiteSpace: "pre-wrap", background: "var(--color-surface-soft)", borderRadius: 8, padding: "10px 12px" }}>{r.message}</div>}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                {r.status !== "inprogress" && <button className="btn btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "inprogress")}>対応中に</button>}
                {r.status !== "done" && <button className="btn ghost btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "done")}>完了</button>}
                {r.status === "done" && <button className="btn ghost btn-xs" disabled={pending && busy === r.id} onClick={() => set(r.id, "new")}>戻す</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
