// #333：案件詳細・人材詳細に表示する「提案ボードの記録（マッチングレコード）」一覧カード。
//   対象（candidate_id / job_id）が合致する提案を一行ずつ、提案管理の該当レコードへリンク表示する。
import Link from "@/components/AppLink";
import type { MatchingRecord } from "@/lib/matching-records";
import { isLostStage } from "@/lib/matching-records";

export function MatchingRecordsCard({ records }: { records: MatchingRecord[] }) {
  if (!records || records.length === 0) return null;
  return (
    <div className="card">
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>
        提案ボードの記録（{records.length}件）
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {records.map((r) => {
          const lost = isLostStage(r.stage);
          const label = [r.candidate_name || "—", r.job_title || "—"].join("／");
          return (
            <Link
              key={r.id}
              href={`/proposals?open=${r.id}`}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--color-border)", textDecoration: "none", color: "var(--color-ink)", fontSize: 12.5 }}
            >
              <span style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99,
                background: lost ? "#f1f5f9" : "#eaf4fd", color: lost ? "#64748b" : "#0b5cab", border: `1px solid ${lost ? "#e2e8f0" : "#bfd9f5"}` }}>
                {lost ? "見送り" : (r.stage || "提案")}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</span>
              <span className="material-symbols-outlined" aria-hidden style={{ marginLeft: "auto", flex: "0 0 auto", fontSize: 16, color: "var(--color-ink-4)" }}>chevron_right</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
