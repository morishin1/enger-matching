"use client";

// ダッシュボードの「要対応」アラートパネル。
//   ・サーバ側で集計した DashboardAlert[] を受け取り、重要度別に色分けして表示。
//   ・各アラートのカードを押すと該当画面へ遷移できる。対応すると pending 件数が
//     0 になるため、次回の表示で自動的に消える（明示的な「消す」処理は不要）。
//   ・session 限定で「一旦非表示」できる × ボタンを付ける（再ロードで再表示）。

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardAlert } from "@/lib/dashboard-alerts";

const SEVERITY_TONE: Record<DashboardAlert["severity"], { bg: string; border: string; ic: string; text: string }> = {
  high: { bg: "#fdecef", border: "#f7c5cf", ic: "#b42318", text: "#7f1d1d" },
  med:  { bg: "#fff6e0", border: "#fde9b0", ic: "#9a5b1a", text: "#783a0c" },
  low:  { bg: "#eef6fd", border: "#cfe5f7", ic: "#0b5cab", text: "#0c4a7a" },
};

const KIND_ICON: Record<DashboardAlert["kind"], string> = {
  approval:       "verified",
  user_signup:    "person_add",
  company_job:    "domain_add",
  review_report:  "rate_review",
  stale_proposal: "hourglass_top",
  lp_candidate:   "groups",
  followup:       "campaign",
  respond_broken: "link_off",
};

const SS_KEY = "enger.dashboard-alerts.dismissed";

export function DashboardAlerts({ alerts }: { alerts: DashboardAlert[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // sessionStorage：タブを閉じるまで非表示。ロード時に復元。
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SS_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch { /* noop */ }
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(id);
      try { sessionStorage.setItem(SS_KEY, JSON.stringify([...next])); } catch { /* noop */ }
      return next;
    });
  };

  const visible = alerts.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "#b42318" }}>notifications_active</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>要対応 <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>· {visible.length}件</span></h3>
        </div>
        <span className="muted" style={{ fontSize: 11 }}>対応すると自動で消えます</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {visible.map((a) => {
          const t = SEVERITY_TONE[a.severity];
          return (
            <div key={a.id}
              style={{ position: "relative", border: `1px solid ${t.border}`, background: t.bg, borderRadius: 12, padding: "12px 12px 12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={() => dismiss(a.id)} title="このセッション中だけ非表示"
                style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 8, border: 0, background: "transparent", color: t.ic, cursor: "pointer", display: "grid", placeItems: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>close</span>
              </button>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: t.ic }}>{KIND_ICON[a.kind] ?? "campaign"}</span>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: t.text, lineHeight: 1.4 }}>{a.title}</div>
              </div>
              {a.body && <div style={{ fontSize: 11.5, color: t.text, opacity: 0.88, lineHeight: 1.6 }}>{a.body}</div>}
              <Link href={a.href}
                style={{ alignSelf: "flex-start", marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, color: t.ic, textDecoration: "none", padding: "5px 10px", borderRadius: 8, border: `1px solid ${t.border}`, background: "#fff" }}>
                {a.cta} <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
