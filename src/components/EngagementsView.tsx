"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEngagementStatus } from "@/lib/actions";

const STATUSES = ["予定", "稼働中", "終了"] as const;
const TONE: Record<string, { bg: string; fg: string }> = {
  予定: { bg: "#fef6e0", fg: "#9a7b12" },
  稼働中: { bg: "#e7f3ea", fg: "#1aa260" },
  終了: { bg: "#eef0f3", fg: "#5a6573" },
};

const dateLabel = (d: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
};

export function EngagementsView({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const setStatus = (id: string, status: string) => start(async () => { await updateEngagementStatus(id, status); router.refresh(); });

  if (rows.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
        まだ稼働がありません。<b style={{ color: "var(--color-ink-2)" }}>提案管理</b>で成約した提案の「稼働化」を押すとここに表示されます。
      </div>
    );
  }

  return (
    <div className="card flush">
      <table className="tbl">
        <thead>
          <tr><th>案件</th><th>人材</th><th style={{ width: 110 }}>月額</th><th style={{ width: 120 }}>開始</th><th style={{ width: 120 }}>終了</th><th style={{ width: 220 }}>ステータス</th></tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const tone = TONE[e.status] ?? TONE["予定"];
            return (
              <tr key={e.id}>
                <td><div className="pri">{e.job_title ?? "—"}</div><div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{e.company ?? ""}</div></td>
                <td>{e.candidate_name ?? "—"}</td>
                <td className="num" style={{ fontWeight: 600 }}>{e.monthly_rate != null ? `¥${Number(e.monthly_rate).toLocaleString("ja-JP")}万` : "—"}</td>
                <td className="num muted">{dateLabel(e.start_date)}</td>
                <td className="num muted">{dateLabel(e.end_date)}</td>
                <td>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ padding: "3px 9px", borderRadius: 99, background: tone.bg, color: tone.fg, fontSize: 11, fontWeight: 700 }}>{e.status}</span>
                    <div style={{ display: "flex", gap: 3, marginLeft: 6 }}>
                      {STATUSES.filter((s) => s !== e.status).map((s) => (
                        <button key={s} type="button" className="btn ghost btn-xs" disabled={pending} onClick={() => setStatus(e.id, s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
