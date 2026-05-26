import { getImportCounts } from "@/lib/import-stats";

/** 管理者ダッシュボード用：CSV取込でDBに入った案件・人材の件数（今日／直近7日）。 */
export async function ImportCounts() {
  const s = await getImportCounts();
  if (!s.available) return null;
  const cell = (label: string, jobs: number, cands: number, accent?: boolean) => (
    <div className="kpi" style={accent ? { borderColor: "var(--color-brand-200)" } : undefined}>
      <div><div className="val tnum">{(jobs + cands).toLocaleString("ja-JP")}<span className="unit">件</span></div>
      <div className="label">{label}</div>
      <div className="note">案件 {jobs.toLocaleString("ja-JP")} / 人材 {cands.toLocaleString("ja-JP")}</div></div>
    </div>
  );
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📥 取込状況（CSV → DB）</h3>
        <span className="muted" style={{ fontSize: 11 }}>マッチング母数の取り込み件数</span>
      </div>
      <div className="kpi-grid">
        {cell("今日の取込", s.today.jobs, s.today.candidates, true)}
        {cell("直近7日", s.week.jobs, s.week.candidates)}
        {cell("累計", s.total.jobs, s.total.candidates)}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginTop: 8 }}>※ CSV取込でDBに入った件数（imported_at基準）。エンジニアの直接登録(LP)は含みません。</div>
    </div>
  );
}
