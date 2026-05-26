import { getCostReport, featureLabel, YEN_PER_USD } from "@/lib/ai-usage";

const yen = (usd: number) => `¥${Math.round(usd * YEN_PER_USD).toLocaleString("ja-JP")}`;

// 各社の請求/使用量ダッシュボード（管理者がワンクリックで確認）
const BILLING_LINKS: { label: string; note: string; url: string }[] = [
  { label: "Anthropic（ENGER内のAI）", note: "提案/勤怠/打合せ等", url: "https://console.anthropic.com/settings/billing" },
  { label: "Google Cloud（Gemini/GAS）", note: "メール分類・抽出", url: "https://console.cloud.google.com/billing" },
  { label: "Vercel（dxホスティング）", note: "アプリ稼働", url: "https://vercel.com/dashboard/usage" },
  { label: "Supabase（中央DB）", note: "データベース", url: "https://supabase.com/dashboard/project/htglvascsuqkixpmclwr/settings/billing" },
  { label: "Cloudflare（LP/LMS）", note: "公開サイト", url: "https://dash.cloudflare.com/?to=/:account/billing" },
];

/** 管理者ダッシュボード用：今月のAIコスト概算＋各社請求リンク。 */
export async function CostReport() {
  const r = await getCostReport();
  const diff = r.thisMonth.usd - r.lastMonth.usd;
  const up = diff > 0;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>💰 月次コストレポート（管理者）</h3>
        <a href="/settings#ai-usage" style={{ fontSize: 11.5, color: "var(--color-brand-700,#0b5cab)", fontWeight: 600, textDecoration: "none" }}>AI使用量の詳細 →</a>
      </div>

      {!r.available ? (
        <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: 14, fontSize: 12.5 }}>
          使用量ログが未整備です。SQL Editor で <span className="mono">supabase/ai-usage.sql</span> を実行すると、ここに今月のAIコストが表示されます。
        </div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 10 }}>
            <div className="kpi brand"><div><div className="val tnum">{yen(r.thisMonth.usd)}</div><div className="label">今月のAIコスト（{r.thisMonth.label}）</div><div className="note">{r.thisMonth.count} 回</div></div></div>
            <div className="kpi"><div><div className="val tnum">{yen(r.lastMonth.usd)}</div><div className="label">前月（{r.lastMonth.label}）</div><div className="note">{r.lastMonth.count} 回</div></div></div>
            <div className="kpi accent"><div><div className="val tnum" style={{ color: up ? "#b42318" : "#067647" }}>{up ? "▲" : "▼"} {yen(Math.abs(diff))}</div><div className="label">前月差</div><div className="note">{up ? "増加" : "減少"}</div></div></div>
          </div>

          {r.byFeature.length > 0 && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--color-ink-3)", marginBottom: 8 }}>
              {r.byFeature.map((f) => <span key={f.feature}>{featureLabel(f.feature)}：<b style={{ color: "var(--color-ink)" }}>{yen(f.usd)}</b>（{f.count}回）</span>)}
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", marginBottom: 12 }}>※ ここに出るのは ENGER内蔵AI（Anthropic）の概算のみ。Gemini(GAS)・インフラ費は各社ダッシュボードで確認してください。</div>
        </>
      )}

      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-ink-3)", marginBottom: 8 }}>各社の請求・使用量ダッシュボード</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {BILLING_LINKS.map((b) => (
            <a key={b.url} href={b.url} target="_blank" rel="noreferrer" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "9px 11px", border: "1px solid var(--color-border)", borderRadius: 10, textDecoration: "none", color: "var(--color-ink)" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>{b.label} ↗</span>
              <span className="muted" style={{ fontSize: 10.5 }}>{b.note}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
