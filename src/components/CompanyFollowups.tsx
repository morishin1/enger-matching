"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markCompanyContacted } from "@/lib/actions";

export type FollowupRow = { name: string; lastISO: string | null; days: number | null; owner: string; contactName: string; contactEmail: string; tier: string };

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }) : "未接触");

/** 3ヶ月以上ご無沙汰の企業リスト。連絡したら「連絡済みにする」で記録し、次の3ヶ月まで非表示に。 */
export function CompanyFollowups({ items }: { items: FollowupRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !done.has(i.name));

  const mark = (name: string) => start(async () => {
    const r = await markCompanyContacted(name);
    if (r.ok) { setDone((p) => new Set(p).add(name)); router.refresh(); }
  });

  if (items.length === 0) return null;
  const td = { padding: "7px 10px" } as const;

  return (
    <div className="card flush">
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📅 3ヶ月以上ご無沙汰（要連絡）</h3>
        <span className="muted" style={{ fontSize: 11 }}>最終接触が古い順 ・ {visible.length}社</span>
      </div>
      {visible.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>要連絡の企業はありません 🎉</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 560 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11 }}>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>企業</th>
                <th style={{ ...td, textAlign: "left" }}>最終接触</th>
                <th style={{ ...td, textAlign: "right" }}>経過</th>
                <th style={{ ...td, textAlign: "left" }}>担当 / 連絡先</th>
                <th style={td}></th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 60).map((c) => (
                <tr key={c.name} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ ...td, fontWeight: 600 }}>{c.name}</td>
                  <td style={td}>{fmt(c.lastISO)}</td>
                  <td style={{ ...td, textAlign: "right", color: (c.days ?? 999) >= 180 ? "#b42318" : "#b45309", fontWeight: 700 }}>{c.days == null ? "—" : `${c.days}日`}</td>
                  <td style={{ ...td, fontSize: 11.5, color: "var(--color-ink-3)" }}>{[c.owner, c.contactName, c.contactEmail].filter(Boolean).join(" / ") || "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <button className="btn ghost btn-xs" disabled={pending} onClick={() => mark(c.name)}>連絡済みにする</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: "8px 16px", fontSize: 10.5, color: "var(--color-ink-4)" }}>※ 最終接触＝直近の案件・打合せ・連絡記録のうち最新。「連絡済みにする」を押すと記録され、約3ヶ月後に再表示されます。</div>
    </div>
  );
}
