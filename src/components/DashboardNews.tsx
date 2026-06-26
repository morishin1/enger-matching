// ダッシュボードの「新着ニュース」。
//   ・やるべきこと（loadDashboardAlerts）… 承認待ち・未確認日報・新規登録者 等の要対応
//   ・新着メッセージ（notifications）……… 応募・登録・日報返信などのお知らせ
//   を1つのフィードにまとめて表示する。
import Link from "@/components/AppLink";
import type { DashboardAlert } from "@/lib/dashboard-alerts";
import type { Notification } from "@/lib/notifications";

const SEV_COLOR: Record<DashboardAlert["severity"], string> = { high: "#dc2626", med: "#e0a317", low: "#0b5cab" };
const KIND_ICON: Record<string, string> = {
  approval: "verified", user_signup: "person_add", company_job: "work", review_report: "edit_note",
  stale_proposal: "schedule", lp_candidate: "groups", followup: "follow_the_signs", respond_broken: "link_off",
};
// notifications.kind → アイコン
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

export function DashboardNews({ alerts, notifications }: { alerts: DashboardAlert[]; notifications: Notification[] }) {
  const hasAny = alerts.length > 0 || notifications.length > 0;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-brand-700)" }}>campaign</span>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>新着ニュース</h2>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>やるべきこと・日報・新規登録者などのお知らせ</span>
      </div>

      {!hasAny ? (
        <div className="muted" style={{ padding: 28, textAlign: "center", fontSize: 13 }}>新着はありません。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* やるべきこと（要対応） */}
          {alerts.map((a) => (
            <Link key={`a-${a.id}`} href={a.href}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--color-border)", textDecoration: "none", color: "inherit" }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: SEV_COLOR[a.severity], flex: "0 0 8px" }} />
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-4)" }}>{KIND_ICON[a.kind] ?? "notifications"}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{a.title}</div>
                {a.body && <div className="muted" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.body}</div>}
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-brand-700)", whiteSpace: "nowrap" }}>{a.cta} ›</span>
            </Link>
          ))}

          {/* 新着メッセージ（お知らせ） */}
          {notifications.map((n) => (
            <div key={`n-${n.id}`} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--color-border)" }}>
              <span style={{ width: 8, flex: "0 0 8px" }} />
              <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-ink-4)", marginTop: 1 }}>{NOTI_ICON[n.kind] ?? "campaign"}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink)" }}>{n.title}</div>
                {n.body && <div className="muted" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{n.body}</div>}
              </div>
              <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap", marginTop: 1 }}>{relTime(n.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
