import { getReportIssues } from "@/lib/daily-report";

const fmt = (d: string) => { const t = new Date(d); return isNaN(t.getTime()) ? d : `${t.getMonth() + 1}/${t.getDate()}`; };

/** 管理者ダッシュボード用：日報に書かれた「課題」を拾ってアラート表示。 */
export async function ReportIssues() {
  const issues = await getReportIssues(2);
  if (issues.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 14, borderColor: "#f6c9d2" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>🚨</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>日報の課題・要フォロー（直近2日）</h3>
        <span className="muted" style={{ fontSize: 11, marginLeft: "auto" }}>{issues.length}件 ・ <a href="/reports" style={{ color: "var(--color-brand-700,#0b5cab)", fontWeight: 600, textDecoration: "none" }}>日報一覧 →</a></span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {issues.map((r, i) => (
          <div key={i} style={{ borderLeft: "3px solid #d23f57", background: "#fdecef", borderRadius: 8, padding: "8px 11px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ fontSize: 12.5 }}>{r.author || "—"}</b>
              <span className="muted" style={{ fontSize: 11 }}>{fmt(r.date)}</span>
              {r.mood && <span className="tag" style={{ fontSize: 10 }}>{r.mood}</span>}
            </div>
            {r.problem && <div style={{ fontSize: 12.5, color: "#b42318", marginTop: 3 }}>⚠ {r.problem}</div>}
            {r.cause && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>原因：{r.cause}</div>}
            {r.next_action && <div style={{ fontSize: 11.5, color: "var(--color-ink-2)", marginTop: 2 }}>▶ 次アクション：{r.next_action}</div>}
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>※ 日報の「課題（problem）」「不調な気分」を自動抽出。早めにフォロー・1on1を。</div>
    </div>
  );
}
