"use client";

// 個人月次KGIの1行エディタ。稼働化目標を入れると月→週→日の提案数が自動算出される。

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePersonKgi } from "@/lib/person-kgi-actions";
import { planFromTarget, type PersonKgi } from "@/lib/person-kgi";

const fmtDateTime = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function PersonKgiEditor({ member, month, initial, conv, bizDays }:
  { member: { email: string; name: string; teamRole: string | null }; month: string; initial: PersonKgi | null; conv: number | null; bizDays: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState(initial?.placement_target != null ? String(initial.placement_target) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const plan = useMemo(() => planFromTarget(Number(target) || 0, conv, month), [target, conv, month]);

  const save = () => {
    setMsg(null);
    start(async () => {
      const res = await savePersonKgi({
        owner_email: member.email,
        owner_name: member.name,
        month,
        placement_target: target.trim() === "" ? null : Number(target),
        note: note.trim() || null,
      });
      if (res.ok) { setMsg({ ok: true, text: "保存しました" }); router.refresh(); }
      else setMsg({ ok: false, text: res.error || "保存に失敗しました" });
    });
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 12, background: "var(--color-surface)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(140px,1fr) 110px 1fr auto", gap: 12, alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{member.name}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            {member.email}{member.teamRole === "manager" ? " ・ マネージャー" : member.teamRole === "leader" ? " ・ リーダー" : ""}
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="meta">稼働化目標</span>
          <div style={{ position: "relative" }}>
            <input type="number" inputMode="decimal" step="any" min={0} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="例: 2"
              style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: "8px 32px 8px 10px", borderRadius: 8, border: "1px solid var(--color-border-strong)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--color-ink-4)" }}>件</span>
          </div>
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span className="meta">逆算（提案数）</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11.5 }}>
            <Chip label="月" value={plan.monthlyProposals} />
            <Chip label="週" value={plan.weeklyProposals} />
            <Chip label="日" value={plan.dailyProposals} highlight />
          </div>
        </div>
        <button type="button" className="btn brand btn-xs" disabled={pending} onClick={save} style={{ height: 32 }}>{pending ? "保存中…" : "保存"}</button>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 220 }}>
          <span className="meta">メモ（任意）</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="背景・コミット内容など"
            style={{ width: "100%", fontFamily: "inherit", fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {msg && <span style={{ fontSize: 11, color: msg.ok ? "#067647" : "var(--color-danger)" }}>{msg.ok ? "✓ " : "⚠ "}{msg.text}</span>}
          {initial?.updated_at && <span className="muted" style={{ fontSize: 10 }}>更新 {fmtDateTime(initial.updated_at)}{initial.updated_by_name ? ` ・ ${initial.updated_by_name}` : ""}</span>}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, highlight }: { label: string; value: number | null; highlight?: boolean }) {
  const v = value == null ? "—" : String(value);
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 4, padding: "3px 9px", borderRadius: 99,
      background: highlight ? "var(--color-brand-25)" : "var(--color-surface-inset)",
      border: `1px solid ${highlight ? "var(--color-brand-100)" : "var(--color-border)"}`,
      fontSize: 11, color: "var(--color-ink-2)",
    }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span className="mono" style={{ fontWeight: 800, color: highlight ? "var(--color-brand-700)" : "var(--color-ink)" }}>{v}</span>
      <span style={{ fontSize: 10, color: "var(--color-ink-4)" }}>件</span>
    </span>
  );
}
