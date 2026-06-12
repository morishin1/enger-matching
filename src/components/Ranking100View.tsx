import Link from "next/link";
import type { RankedPair } from "@/lib/ranking100";

// ランキング100：必須スキル一致率75%以上の案件×人材ペアを上位100件表示（サーバコンポーネント）。
//   行クリック相当の操作は「→ 提案画面」リンクに集約（/matching?job=X&cand=Y でそのペアを開く）。

const salaryLabel = (lo?: number | null, hi?: number | null) =>
  lo && hi ? (lo === hi ? `¥${lo}万` : `¥${lo}〜${hi}万`) : hi ? `〜¥${hi}万` : lo ? `¥${lo}万〜` : "—";

function RankBadge({ n }: { n: number }) {
  const color = n === 1 ? "#f0a92b" : n === 2 ? "#9aa7b4" : n === 3 ? "#cd853f" : "var(--color-surface-inset)";
  const fg = n <= 3 ? "#fff" : "var(--color-ink-3)";
  return (
    <span style={{ display: "inline-grid", placeItems: "center", width: 28, height: 28, borderRadius: 99, background: color, color: fg, fontSize: 12, fontWeight: 800, fontFamily: "var(--font-display)" }}>{n}</span>
  );
}

export function Ranking100View({ rows, meta }: { rows: RankedPair[]; meta: { jobsScanned: number; candsScanned: number; pairsHit: number } }) {
  return (
    <div className="card flush">
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🏆 ランキング100 <span className="tag brand">{rows.length}件</span></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            必須スキル一致率 <b>75%以上</b> のペアを一致率 → 総合スコア順で表示。
            対象：案件 {meta.jobsScanned.toLocaleString("ja-JP")} 件 × 人材 {meta.candsScanned.toLocaleString("ja-JP")} 名（適合 {meta.pairsHit.toLocaleString("ja-JP")} ペア）・5分毎に更新。
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--color-ink-4)", fontSize: 13 }}>
          必須スキルが75%以上一致するペアが見つかりませんでした。案件・人材のスキル登録を充実させると候補が増えます。
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5, minWidth: 980 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11, background: "var(--color-surface-soft)" }}>
                <th style={{ padding: "8px 10px", width: 48 }}>順位</th>
                <th style={{ padding: "8px 10px", textAlign: "left", width: 90 }}>一致率</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>案件</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>人材</th>
                <th style={{ padding: "8px 10px", textAlign: "left" }}>一致スキル</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 76 }}>総合</th>
                <th style={{ padding: "8px 10px", textAlign: "right", width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.job.job_no}-${r.cand.candidate_no}`} style={{ opacity: r.proposed ? 0.62 : 1, background: r.proposed ? "var(--color-surface-inset)" : undefined }}>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "center" }}><RankBadge n={r.rank} /></td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <span className="display tnum" style={{ fontSize: 16, fontWeight: 800, color: r.skillPct >= 100 ? "#067647" : r.skillPct >= 90 ? "#0b5cab" : "#9a5b1a" }}>{r.skillPct}%</span>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/jobs/${r.job.job_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.job.title}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>No.{String(r.job.job_no).padStart(5, "0")}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.job.client_name, salaryLabel(r.job.salary_min, r.job.salary_max)].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Link href={`/people/${r.cand.candidate_no}`} style={{ color: "var(--color-brand-700)", textDecoration: "none" }}>{r.cand.name}</Link>
                      <span className="mono muted" style={{ fontSize: 10, fontWeight: 400 }}>P-{String(r.cand.candidate_no).padStart(5, "0")}</span>
                      {r.proposed && <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 99, background: "#e8ebef", color: "#5b6675", border: "1px solid #d3d9e0" }}>✓ 提案済み</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{[r.cand.title, r.cand.company, r.cand.rate].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.matchedSkills.slice(0, 6).map((s) => <span key={s} className="tag brand" style={{ fontSize: 10 }}>{s}</span>)}
                      {r.matchedSkills.length > 6 && <span className="muted" style={{ fontSize: 10.5, fontWeight: 600 }}>+{r.matchedSkills.length - 6}</span>}
                    </div>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right" }}>
                    <span className="display tnum" style={{ fontWeight: 800 }}>{r.score}</span><span className="muted" style={{ fontSize: 10 }}>%</span>
                  </td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/matching?job=${r.job.job_no}&cand=${r.cand.candidate_no}`} className="btn brand btn-xs" style={{ textDecoration: "none" }}
                      title="このペアでマッチング画面（提案）を開く">→ 提案画面</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
