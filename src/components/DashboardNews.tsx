"use client";

// ダッシュボードの「新着ニュース」。左右2ブロック（やらなければいけないこと／お知らせ）を
//   基本はアコーディオンで閉じておき、未読があれば「NEW＋未読件数」を出す。
//   開いて各項目を読む（クリック or「既読にする」）と既読になり、未読一覧から消えて
//   「過去の履歴」に回る。既読状態は端末ローカル（localStorage）に保存する。
//
// 定義（lib/dashboard-alerts.ts / lib/notifications.ts のドキュメントに準拠）：
//   ・やらなければいけないこと＝今アクションしないと進まない締切性のタスク（対応で消える）。
//   ・お知らせ＝起きた出来事の通知・周知（読めばよい情報。既読で履歴へ）。
import { useEffect, useState } from "react";
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

// 端末ローカルに既読IDを保存するフック。
function useSeen(key: string): { seen: Set<string>; ready: boolean; mark: (ids: string[]) => void } {
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setSeen(new Set(JSON.parse(localStorage.getItem(key) || "[]"))); } catch { /* ignore */ }
    setReady(true);
  }, [key]);
  const mark = (ids: string[]) => {
    setSeen((prev) => {
      const next = new Set(prev);
      ids.forEach((i) => next.add(i));
      try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  return { seen, ready, mark };
}

function AlertRow({ a, onSeen }: { a: DashboardAlert; onSeen?: () => void }) {
  return (
    <Link href={a.href} onClick={onSeen}
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

function NotiRow({ n, onSeen }: { n: Notification; onSeen?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--color-border)" }}>
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-4)", marginTop: 1 }}>{NOTI_ICON[n.kind] ?? "campaign"}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{n.title}</div>
        {n.body && <div className="muted" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{n.body}</div>}
        {/* #342：承認依頼は承認待ちタブへ直接飛べるリンクを添える（人材名×案件名は本文に表示）。 */}
        {n.kind === "approval" && (
          <Link href="/proposals?tab=approval" style={{ display: "inline-block", marginTop: 4, fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)", textDecoration: "none" }}>
            承認待ちタブを開く ›
          </Link>
        )}
      </div>
      <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", marginTop: 1 }}>{relTime(n.created_at)}</span>
      {onSeen && <button type="button" className="btn ghost btn-xs" onClick={onSeen} style={{ flexShrink: 0 }}>既読</button>}
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

// アコーディオン1ブロック分（やらなければいけないこと／お知らせ 共通）。
function AccordionBlock({ icon, iconColor, title, unreadCount, ready, children, onAllRead, onHistory }: {
  icon: string; iconColor: string; title: string; unreadCount: number; ready: boolean;
  children: React.ReactNode; onAllRead?: () => void; onHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasUnread = ready && unreadCount > 0;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: open ? "1px solid var(--color-border)" : "none" }}>
        <button type="button" onClick={() => setOpen((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "left" }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-4)", transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>chevron_right</span>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: iconColor }}>{icon}</span>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{title}</h2>
          {hasUnread && (
            <>
              <span style={{ fontSize: 9, padding: "1px 6px", letterSpacing: ".04em", fontWeight: 800, borderRadius: 99, background: "#dc2626", color: "#fff", lineHeight: 1.4 }}>NEW</span>
              <span className="badge" style={{ fontSize: 11, padding: "1px 8px" }}>未読 {unreadCount}</span>
            </>
          )}
        </button>
        <button type="button" className="btn ghost btn-xs" onClick={onHistory} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15 }}>history</span>過去の履歴
        </button>
      </div>
      {open && (
        unreadCount === 0 ? (
          <div className="muted" style={{ padding: 24, textAlign: "center", fontSize: 12.5 }}>新着はありません。「過去の履歴」から確認できます。</div>
        ) : (
          <div>
            {children}
            {onAllRead && (
              <div style={{ padding: "10px 16px", textAlign: "right" }}>
                <button type="button" className="btn ghost btn-xs" onClick={onAllRead}>
                  <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 15, verticalAlign: "-3px", marginRight: 2 }}>done_all</span>すべて既読にする
                </button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

export function DashboardNews({ alerts, notifications }: { alerts: DashboardAlert[]; notifications: Notification[] }) {
  const todo = useSeen("dash_seen_todo");
  const news = useSeen("dash_seen_news");
  const [modal, setModal] = useState<null | "todo" | "news">(null);

  const unreadAlerts = alerts.filter((a) => !todo.seen.has(a.id));
  const unreadNotis = notifications.filter((n) => !news.seen.has(n.id));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
      {/* 左：やらなければいけないこと */}
      <AccordionBlock icon="checklist" iconColor="#dc2626" title="やらなければいけないこと"
        unreadCount={unreadAlerts.length} ready={todo.ready}
        onAllRead={() => todo.mark(unreadAlerts.map((a) => a.id))}
        onHistory={() => setModal("todo")}>
        {unreadAlerts.slice(0, TOP).map((a) => <AlertRow key={a.id} a={a} onSeen={() => todo.mark([a.id])} />)}
      </AccordionBlock>

      {/* 右：お知らせ */}
      <AccordionBlock icon="campaign" iconColor="var(--color-brand-700)" title="お知らせ"
        unreadCount={unreadNotis.length} ready={news.ready}
        onAllRead={() => news.mark(unreadNotis.map((n) => n.id))}
        onHistory={() => setModal("news")}>
        {unreadNotis.slice(0, TOP).map((n) => <NotiRow key={n.id} n={n} onSeen={() => news.mark([n.id])} />)}
      </AccordionBlock>

      {modal === "todo" && (
        <HistoryModal title="やらなければいけないこと（過去の履歴）" onClose={() => setModal(null)}>
          {alerts.length === 0
            ? <div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>履歴はありません。</div>
            : alerts.map((a) => <AlertRow key={a.id} a={a} />)}
        </HistoryModal>
      )}
      {modal === "news" && (
        <HistoryModal title="お知らせ（過去の履歴）" onClose={() => setModal(null)}
          footer={<Link href="/notifications" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>すべてのお知らせを見る ›</Link>}>
          {notifications.length === 0
            ? <div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>履歴はありません。</div>
            : notifications.map((n) => <NotiRow key={n.id} n={n} />)}
        </HistoryModal>
      )}
    </div>
  );
}
