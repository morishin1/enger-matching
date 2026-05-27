import type { CompanyMatrix } from "@/lib/companies";

const TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  "エンド/SI": { bg: "#eaf4fd", fg: "#0b5cab" },
  "パートナー": { bg: "#fff1e6", fg: "#b45309" },
  "両取引": { bg: "#e7f3ea", fg: "#067647" },
};

/** 取引構造：エンド/SI（案件元）× パートナーSES（人材元）の連動分析と開拓判断。 */
export function CompanyStructure({ matrix }: { matrix: CompanyMatrix }) {
  const n = (v: number) => v.toLocaleString("ja-JP");
  const td = { padding: "7px 10px", textAlign: "right" as const };
  return (
    <>
      {/* 開拓判断バナー（やるべき事＋導線） */}
      <div className="card" style={{ borderColor: matrix.reco.tone, background: `${matrix.reco.tone}10` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>{matrix.reco.tone === "#1aa260" ? "✅" : "📣"}</span>
          <b style={{ fontSize: 13.5, color: matrix.reco.tone }}>やること：{matrix.reco.text}</b>
          {matrix.reco.tone === "#d23f57" && <a href="/jobs" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#d23f57", textDecoration: "none" }}>→ 案件を増やす（案件一覧/取込）</a>}
          {matrix.reco.tone === "#d98a2b" && <a href="/people" style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "#b45309", textDecoration: "none" }}>→ 人材を増やす（人材一覧/取込）</a>}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
          エンド/SI（直案件＝jobs.client_name）＝<b>{n(matrix.endCount)}社</b>・案件{n(matrix.totalJobs)}件 ／ パートナーSES（人材の所属＝candidates.company）＝<b>{n(matrix.partnerCount)}社</b>・人材{n(matrix.totalCands)}名 ／ 両取引 <b>{n(matrix.bothCount)}社</b>
        </div>
      </div>

      {/* KPI（クリックで根拠ページへ） */}
      <div className="kpi-grid">
        <a className="kpi brand" href="/jobs" style={{ textDecoration: "none", color: "inherit" }}><div><div className="val tnum">{n(matrix.endCount)}<span className="unit">社</span></div><div className="label">エンド/SI（案件元）›</div><div className="note">直案件・SI ・ 計{n(matrix.totalJobs)}件</div></div></a>
        <a className="kpi warn" href="/people" style={{ textDecoration: "none", color: "inherit" }}><div><div className="val tnum">{n(matrix.partnerCount)}<span className="unit">社</span></div><div className="label">パートナーSES（人材元）›</div><div className="note">人材供給 ・ 計{n(matrix.totalCands)}名</div></div></a>
        <div className="kpi accent"><div><div className="val tnum">{n(matrix.bothCount)}<span className="unit">社</span></div><div className="label">両取引（案件＋人材）</div><div className="note">最重要パートナー</div></div></div>
        <a className="kpi" href="/jobs" style={{ textDecoration: "none", color: "inherit" }}><div><div className="val tnum">{n(matrix.totalJobs)}<span className="unit">件</span></div><div className="label">総案件 / 総人材 ›</div><div className="note">人材 {n(matrix.totalCands)} 名</div></div></a>
      </div>

      {/* 企業別 案件数・人材数 */}
      <div className="card flush">
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🏢 企業別 取引ボリューム（案件 × 人材）</h3>
          <span className="muted" style={{ fontSize: 11 }}>案件＋人材が多い順 上位{matrix.rows.length}社</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, minWidth: 460 }}>
            <thead>
              <tr style={{ color: "var(--color-ink-4)", fontSize: 11 }}>
                <th style={{ textAlign: "left", padding: "8px 10px" }}>企業</th>
                <th style={{ ...td, textAlign: "center" }}>種別</th>
                <th style={td}>案件数</th><th style={td}>人材数</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => {
                const t = TYPE_TONE[r.type];
                return (
                  <tr key={r.name} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600 }}><a href={`/jobs?client=${encodeURIComponent(r.name)}`} style={{ color: "var(--color-brand-700,#0b5cab)", textDecoration: "none" }}>{r.name} ›</a></td>
                    <td style={{ ...td, textAlign: "center" }}><span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: t.bg, color: t.fg }}>{r.type}</span></td>
                    <td style={{ ...td, fontWeight: r.jobs > 0 ? 700 : 400 }} className="tnum">{r.jobs > 0 ? <a href={`/jobs?client=${encodeURIComponent(r.name)}`} style={{ color: "#0b5cab", textDecoration: "none" }}>{r.jobs}</a> : <span style={{ color: "var(--color-ink-4)" }}>—</span>}</td>
                    <td style={{ ...td, fontWeight: r.cands > 0 ? 700 : 400 }} className="tnum">{r.cands > 0 ? <a href={`/people?q=${encodeURIComponent(r.name)}`} style={{ color: "#b45309", textDecoration: "none" }}>{r.cands}</a> : <span style={{ color: "var(--color-ink-4)" }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "8px 16px", fontSize: 10.5, color: "var(--color-ink-4)" }}>※ エンド/SI＝直案件を出す企業（案件を開拓）／パートナーSES＝人材を送ってくる企業（人材を開拓）。案件が少なければエンド/SI、人材が少なければパートナーを開拓。</div>
      </div>
    </>
  );
}
