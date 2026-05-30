// 副業エージェント(freelance)向けホーム（ag.enger.jp）。
//   - 報酬ダッシュボード（自分が登録した人材/案件で稼働中の月額 × ％）
//   - 主要メニューへの導線
import Link from "next/link";
import { getFreelanceCommission } from "@/lib/commission";

const yen = (man: number) => (man >= 10000 ? `${(man / 10000).toFixed(2)}億円` : `${man.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`);

export async function FreelanceHome({ displayName, email }: { displayName?: string | null; email?: string | null }) {
  const report = email ? await getFreelanceCommission(email) : null;
  const cards = [
    { href: "/matching", icon: "compare_arrows", t: "マッチング", d: "自分＋共有の案件・人材で相性の良いペアを表示（他社は匿名）。" },
    { href: "/jobs", icon: "work", t: "案件（自分・共有）", d: "あなたが集めた案件を登録・管理。共有案件も匿名で確認。" },
    { href: "/people", icon: "groups", t: "人材（自分・共有）", d: "あなたが集めた人材を登録・管理。共有人材も匿名で確認。" },
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="meta">ENGER Agent · 副業エージェント</div>
          <h1>ようこそ{displayName ? `、${displayName} さん` : ""}</h1>
          <div className="sub">スキマ時間で人材・案件を集め、マッチングに貢献いただけます。<b>他社の情報は匿名（イニシャル＋スキル＋単価）</b>で表示され、氏名・連絡先は表示されません。提案・契約は社内担当が仲介します。</div>
        </div>
      </div>

      {/* 報酬ダッシュボード（自分が登録した人材/案件で稼働中のエンゲージメントから算出） */}
      <div className="card" style={{ background: "linear-gradient(135deg, #f7fbff 0%, #eef6fd 100%)", borderColor: "#cfe7f8", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 26, color: "#0095D9" }}>payments</span>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>あなたの報酬ダッシュボード</h3>
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>紹介報酬率 {report?.ratePct ?? "—"}%（稼働中の月額に対して）</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 12 }}>
          <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>今月の見込み報酬</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#0F2440", marginTop: 4, fontFamily: "var(--font-display)" }}>{report ? yen(report.totalMonthlyMan) : "—"}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>稼働中の月額×{report?.ratePct ?? 0}%</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>年換算</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0F2440", marginTop: 4, fontFamily: "var(--font-display)" }}>{report ? yen(report.annualEstimateMan) : "—"}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>現在の稼働が継続した場合</div>
          </div>
          <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: "var(--color-ink-4)", fontWeight: 700 }}>対象の稼働数</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#0F2440", marginTop: 4, fontFamily: "var(--font-display)" }}>{report?.count ?? 0}<span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-ink-4)", marginLeft: 4 }}>件</span></div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>あなた経由（人材 or 案件）</div>
          </div>
        </div>

        {/* 明細 */}
        {report && report.entries.length > 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--color-border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", fontSize: 12, fontWeight: 700 }}>明細</div>
            <table className="tbl tbl-compact">
              <thead><tr><th>経路</th><th>案件</th><th>人材</th><th className="num">月額</th><th className="num">月額報酬</th></tr></thead>
              <tbody>
                {report.entries.map((e) => (
                  <tr key={e.engagement_id}>
                    <td><span className="tag" style={{ fontSize: 10, padding: "1px 8px", background: e.via === "人材" ? "#eef2ff" : "#fff5e6", color: e.via === "人材" ? "#3730a3" : "#b45309" }}>{e.via}経由</span></td>
                    <td style={{ fontSize: 12 }}>{e.job_title ?? "—"}</td>
                    <td style={{ fontSize: 12 }}>{e.candidate_name ?? "—"}</td>
                    <td className="num" style={{ fontSize: 12 }}>{yen(e.monthly_rate)}</td>
                    <td className="num" style={{ fontSize: 12, fontWeight: 800, color: "#0095D9" }}>{yen(e.monthly_commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ background: "#fff", border: "1px dashed var(--color-border)", borderRadius: 12, padding: 18, textAlign: "center", color: "var(--color-ink-4)", fontSize: 12.5 }}>
            あなた経由の稼働中エンゲージメントはまだありません。<br />
            <b style={{ color: "var(--color-ink-2)" }}>人材・案件を登録 → マッチング → 成約</b> で報酬が発生します。
          </div>
        )}

        <div className="muted" style={{ fontSize: 10.5 }}>
          ※ 報酬は「あなたが登録した人材」または「あなたが登録した案件」が稼働中（または予定）の場合の月額に対し {report?.ratePct ?? 0}% を仮算出した参考値です。実際の支払いは契約条件と運営確認に基づきます。
        </div>
      </div>

      {/* メニュー */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 14 }}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="card" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 6, padding: 18 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 26, color: "var(--color-brand-700)" }}>{c.icon}</span>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{c.t}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.7 }}>{c.d}</div>
          </Link>
        ))}
      </div>

      <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 12.5, color: "var(--color-ink-2)" }}>
        ※ あなたが登録した案件・人材はあなたのみ閲覧できます。共有設定したものだけ、他のエージェント・企業とマッチング対象になります（匿名表示）。
      </div>
    </div>
  );
}
