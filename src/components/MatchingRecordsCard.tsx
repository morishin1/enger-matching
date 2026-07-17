// #333：案件詳細・人材詳細に表示する「提案ボードの記録（マッチングレコード）」一覧カード。
//   対象（candidate_id / job_id）が合致する提案を一行ずつ、提案管理の該当レコードへリンク表示する。
import Link from "@/components/AppLink";
import type { MatchingRecord } from "@/lib/matching-records";
import { isLostStage } from "@/lib/matching-records";
import { ActionChips } from "@/components/ProposalActionChip";

// 提案日の表示（proposed_at 優先、無ければ created_at）。YYYY/M/D。
function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "—" : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function MatchingRecordsCard({ records }: { records: MatchingRecord[] }) {
  if (!records || records.length === 0) return null;
  return (
    <div className="card">
      <div style={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600, marginBottom: 8 }}>
        提案ボードの記録（{records.length}件）
      </div>
      {/* #470：提案日＋案件先/人材先の応答（話を進める=緑/見送り=赤/未回答）を提案管理と同じ表示で並べる。 */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {records.map((r) => {
          const lost = isLostStage(r.stage);
          const label = [r.candidate_name || "—", r.job_title || "—"].join("／");
          const proposedAt = r.proposed_at ?? r.created_at;
          return (
            <Link
              key={r.id}
              href={`/proposals?open=${r.id}`}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--color-border)", textDecoration: "none", color: "var(--color-ink)", fontSize: 12.5, flexWrap: "wrap" }}
            >
              <span style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 700, padding: "1px 8px", borderRadius: 99,
                background: lost ? "#f1f5f9" : "#eaf4fd", color: lost ? "#64748b" : "#0b5cab", border: `1px solid ${lost ? "#e2e8f0" : "#bfd9f5"}` }}>
                {lost ? "見送り" : (r.stage || "提案")}
              </span>
              <span style={{ minWidth: 0, flex: "1 1 140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>{label}</span>
              {/* 提案日 */}
              <span className="muted" title="提案日" style={{ flex: "0 0 auto", fontSize: 11, whiteSpace: "nowrap" }}>提案 {fmtDate(proposedAt)}</span>
              {/* 案件先(案)／人材先(人) の応答ランプ：話を進める=緑 / 見送り=赤 / 未回答=破線 */}
              <ActionChips jobType={r.job_action_type} candType={r.cand_action_type} compact />
              <span className="material-symbols-outlined" aria-hidden style={{ marginLeft: "auto", flex: "0 0 auto", fontSize: 16, color: "var(--color-ink-4)" }}>chevron_right</span>
            </Link>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.7 }}>
        <b>案</b>＝案件先／<b>人</b>＝人材先の応答。緑＝話を進める・赤＝見送り・破線＝未回答（提案管理と同じ表示）。
      </div>
    </div>
  );
}
