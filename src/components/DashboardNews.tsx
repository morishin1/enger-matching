"use client";

// ダッシュボードの「新着ニュース」。左右2ブロックに分けて表示する。
//   ・左：やらなければいけないこと（loadDashboardAlerts）… 承認待ち・未確認日報・新規登録者 等の要対応
//   ・右：お知らせ（notifications）……………………………… 応募・登録・日報返信などのメッセージ
//   各ブロックは上位5件のみ表示し、「過去の履歴」ボタンで全件をモーダル表示できる。
import { useState } from "react";
import Link from "@/components/AppLink";
import type { DashboardAlert } from "@/lib/dashboard-alerts";
import type { Notification } from "@/lib/notifications";

const TOP = 5;

const SEV_COLOR: Record<DashboardAlert["severity"], string> = { high: "#dc2626", med: "#e0a317", low: "#0b5cab" };
const KIND_ICON: Record<string, string> = {
  approval: "verified", user_signup: "person_add", company_job: "work", review_report: "edit_note",
  stale_proposal: "schedule", lp_candidate: "groups", followup: "follow_the_signs", respond_broken: "link_off",
};
const NOTI_ICON: Record<string, string> = { info: "campaign", feedback: "reply", warning: "warning", apply: "assignment_ind" };

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}日前`;
  const dt = new Date(iso);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function AlertRow({ a }: { a: DashboardAlert }) {
  return (
    <Link href={a.href}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--color-border)", textDecoration: "none", color: "inherit" }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLOR[a.severity], flex: "0 0 8px" }} />
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-4)" }}>{KIND_ICON[a.kind] ?? "notifications"}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{a.title}</div>
        {a.body && <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.body}</div>}
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)", whiteSpace: "nowrap" }}>{a.cta} ›</span>
    </Link>
  );
}

function NotiRow({ n }: { n: Notification }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--color-border)" }}>
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-4)", marginTop: 1 }}>{NOTI_ICON[n.kind] ?? "campaign"}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{n.title}</div>
        {n.body && <div className="muted" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{n.body}</div>}
      </div>
      <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", marginTop: 1 }}>{relTime(n.created_at)}</span>
    </div>
  );
}

function Block({ icon, iconColor, title, count, empty, children, onHistory }: {
  icon: string; iconColor: string; title: string; count: number; empty: string; children: React.ReactNode; onHistory?: () => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: iconColor }}>{icon}</span>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</h2>
        {count > 0 && <span className="badge" style={{ fontSize: 11, padding: "1px 8px" }}>{count}</span>}
        {onHistory && (
          <button type="button" className="btn ghost btn-xs" onClick={onHistory} style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15 }}>history</span>過去の履歴
          </button>
        )}
      </div>
      {count === 0 ? <div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>{empty}</div> : <div>{children}</div>}
    </div>
  );
}

function HistoryModal({ title, onClose, footer, children }: { title: string; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 640, maxHeight: "85vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</h3>
          <button type="button" className="btn ghost btn-xs" onClick={onClose}>閉じる</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && <div style={{ padding: "10px 16px", borderTop: "1px solid var(--color-border)", textAlign: "right" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function DashboardNews({ alerts, notifications }: { alerts: DashboardAlert[]; notifications: Notification[] }) {
  const [modal, setModal] = useState<null | "todo" | "news">(null);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
      {/* 左：やらなければいけないこと */}
      <Block icon="checklist" iconColor="#dc2626" title="やらなければいけないこと" count={alerts.length}
        empty="対応が必要なものはありません。"
        onHistory={alerts.length > 0 ? () => setModal("todo") : undefined}>
        {alerts.slice(0, TOP).map((a) => <AlertRow key={a.id} a={a} />)}
      </Block>

      {/* 右：お知らせ */}
      <Block icon="campaign" iconColor="var(--color-brand-700)" title="お知らせ" count={notifications.length}
        empty="新着のお知らせはありません。"
        onHistory={() => setModal("news")}>
        {notifications.slice(0, TOP).map((n) => <NotiRow key={n.id} n={n} />)}
      </Block>

      {modal === "todo" && (
        <HistoryModal title="やらなければいけないこと（すべて）" onClose={() => setModal(null)}>
          {alerts.map((a) => <AlertRow key={a.id} a={a} />)}
        </HistoryModal>
      )}
      {modal === "news" && (
        <HistoryModal title="お知らせ（過去の履歴）" onClose={() => setModal(null)}
          footer={<Link href="/notifications" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>すべてのお知らせを見る ›</Link>}>
          {notifications.length === 0
            ? <div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>お知らせはありません。</div>
            : notifications.map((n) => <NotiRow key={n.id} n={n} />)}
        </HistoryModal>
      )}
    </div>
  );
}
