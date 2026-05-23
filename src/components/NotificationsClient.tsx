"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNotificationRead, markAllRead } from "@/app/notifications/actions";
import type { Notification } from "@/lib/notifications";

const dateLabel = (d: string) => { const t = new Date(d); return isNaN(t.getTime()) ? "" : `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; };

export function NotificationsClient({ items, me }: { items: Notification[]; me: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const unread = items.filter((n) => !n.read_at).length;
  const read = (id: string) => start(async () => { await markNotificationRead(id); router.refresh(); });
  const allRead = () => start(async () => { await markAllRead(me); router.refresh(); });

  if (items.length === 0) return <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>お知らせはありません。</div>;

  return (
    <>
      {unread > 0 && <div style={{ display: "flex", justifyContent: "flex-end" }}><button className="btn ghost btn-xs" disabled={pending} onClick={allRead}>すべて既読にする（{unread}）</button></div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((n) => (
          <div key={n.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 6, borderLeft: `3px solid ${n.read_at ? "var(--color-border)" : "var(--color-brand-600)"}`, background: n.read_at ? "var(--color-surface)" : "var(--color-brand-25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 13.5 }}>{!n.read_at && <span style={{ color: "var(--color-brand-600)" }}>● </span>}{n.title}</b>
              <span className="muted mono" style={{ fontSize: 11 }}>{dateLabel(n.created_at)}</span>
            </div>
            {n.body && <div style={{ fontSize: 13, color: "var(--color-ink-2)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{n.body}</div>}
            {!n.read_at && <button className="btn ghost btn-xs" disabled={pending} onClick={() => read(n.id)} style={{ alignSelf: "flex-start" }}>既読にする</button>}
          </div>
        ))}
      </div>
    </>
  );
}
