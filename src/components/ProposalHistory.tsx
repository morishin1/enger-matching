"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreProposal } from "@/lib/actions";

const STAGE_TONE: Record<string, { bg: string; fg: string }> = {
  見送り: { bg: "#fdecef", fg: "#b42318" },
  失注: { bg: "#fdecef", fg: "#b42318" },
  稼働: { bg: "#e7f3ea", fg: "#067647" },
  稼働決定: { bg: "#e7f3ea", fg: "#067647" },
};
const fmt = (d: any) => { if (!d) return "—"; const t = new Date(d); return isNaN(t.getTime()) ? "—" : `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`; };

/** 過去の提案（見送り/失注/稼働化済）の履歴。各行をボードに戻せる。 */
export function ProposalHistory({ items }: { items: any[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");

  const restore = (id: string, label: string) => {
    if (!confirm(`「${label}」をボードに戻しますか？（ステージ=返信待ちに戻ります。稼働化済みの場合は稼働も取り消されます）`)) return;
    start(async () => { await restoreProposal(id); router.refresh(); });
  };

  const filtered = items.filter((p) => !q.trim() || (p.candidate_name ?? "").includes(q.trim()) || (p.company ?? "").includes(q.trim()) || (p.job_title ?? "").includes(q.trim()));
  const td = { padding: "7px 10px" } as const;

  return (
    <div className="card flush">
      <details>
        <summary style={{ cursor: "pointer", listStyle: "none", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📜 過去の提案（履歴）</h3>
          <span className="muted" style={{ fontSize: 11 }}>見送り・失注・稼働化済 {items.length}件 ・ クリックで開閉</span>
        </summary>
        <div style={{ padding: "0 16px 14px" }}>
          <div className="tbl-search" style={{ width: 240, margin: "4px 0 10px" }}><input placeholder="人材・企業・案件で検索…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 640 }}>
              <thead>
                <tr style={{ color: "var(--color-ink-4)", fontSize: 11 }}>
                  <th style={{ textAlign: "left", padding: "8px 10px" }}>人材</th>
                  <th style={{ ...td, textAlign: "left" }}>企業 / 案件</th>
                  <th style={{ ...td, textAlign: "center" }}>結果</th>
                  <th style={{ ...td, textAlign: "left" }}>提案者 / CL</th>
                  <th style={{ ...td, textAlign: "left" }}>失注理由</th>
                  <th style={{ ...td, textAlign: "left" }}>日付</th>
                  <th style={td}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map((p) => {
                  const t = STAGE_TONE[p.stage] ?? { bg: "var(--color-surface-inset)", fg: "var(--color-ink-3)" };
                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ ...td, fontWeight: 600 }}>{p.candidate_name ?? "—"}</td>
                      <td style={td}>{p.company ?? ""}{p.job_title ? ` / ${p.job_title}` : ""}</td>
                      <td style={{ ...td, textAlign: "center" }}><span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: t.bg, color: t.fg }}>{p.stage}</span></td>
                      <td style={{ ...td, color: "var(--color-ink-3)" }}>{[p.proposer, p.closer].filter(Boolean).join(" / ") || "—"}</td>
                      <td style={{ ...td, color: "var(--color-ink-3)" }}>{p.lost_reason || "—"}</td>
                      <td style={td}>{fmt(p.updated_at || p.created_at)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <button className="btn ghost btn-xs" disabled={pending} onClick={() => restore(p.id, `${p.candidate_name ?? ""} × ${p.job_title ?? ""}`)}>↩ 戻す</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
