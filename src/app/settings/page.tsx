import { StaffManager } from "@/components/StaffManager";
import { getStaff } from "@/lib/staff";
import { getUsageStats, featureLabel, YEN_PER_USD } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

const yen = (usd: number) => `¥${Math.round(usd * YEN_PER_USD).toLocaleString("ja-JP")}`;

export default async function SettingsPage() {
  const staff = await getStaff();
  const usage = await getUsageStats();
  const maxDaily = Math.max(0.0001, ...usage.daily.map((d) => d.usd));

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Settings · 設定</div>
          <h1>設定</h1>
          <div className="sub">担当者マスタの管理と、AI機能の使用量・概算コストを確認できます。</div>
        </div>
      </div>

      {/* AI使用量 */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>🤖 AI使用量・概算コスト</h3>
          <span className="muted" style={{ fontSize: 11 }}>直近30日 / 概算（¥{YEN_PER_USD}/$ 換算）</span>
        </div>

        {!usage.available ? (
          <div style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", borderRadius: 10, padding: 14, fontSize: 12.5 }}>
            使用量ログのテーブルが未作成です。SQL Editor で <span className="mono">supabase/ai-usage.sql</span> を実行すると、ここに使用量グラフが表示されます。
          </div>
        ) : (
          <>
            <div className="kpi-grid" style={{ marginBottom: 14 }}>
              <div className="kpi brand"><div><div className="val tnum">{yen(usage.thisMonth.usd)}</div><div className="label">今月の概算コスト</div><div className="note">{usage.thisMonth.count} 回</div></div></div>
              <div className="kpi"><div><div className="val tnum">{yen(usage.total.usd)}</div><div className="label">直近30日コスト</div><div className="note">{usage.total.count} 回</div></div></div>
              {usage.byFeature.slice(0, 2).map((f) => (
                <div key={f.feature} className="kpi accent"><div><div className="val tnum">{yen(f.usd)}</div><div className="label">{featureLabel(f.feature)}</div><div className="note">{f.count} 回</div></div></div>
              ))}
            </div>

            {/* 日別バーチャート（直近30日のコスト） */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, padding: "8px 4px", borderBottom: "1px solid var(--color-border)" }}>
              {usage.daily.map((d, i) => {
                const h = Math.round((d.usd / maxDaily) * 100);
                return (
                  <div key={i} title={`${d.date}：${yen(d.usd)} / ${d.count}回`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%" }}>
                    <div style={{ width: "100%", maxWidth: 16, height: `${Math.max(d.usd > 0 ? 6 : 0, h)}%`, background: d.usd > 0 ? "var(--color-brand-600)" : "transparent", borderRadius: "3px 3px 0 0" }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-ink-4)", marginTop: 4 }}>
              <span>{usage.daily[0]?.date}</span><span>30日間のAIコスト推移</span><span>{usage.daily[usage.daily.length - 1]?.date}</span>
            </div>

            {usage.byFeature.length > 0 && (
              <div style={{ marginTop: 14, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--color-ink-3)" }}>
                {usage.byFeature.map((f) => <span key={f.feature}>{featureLabel(f.feature)}：<b style={{ color: "var(--color-ink)" }}>{f.count}回 / {yen(f.usd)}</b></span>)}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 10.5, color: "var(--color-ink-4)" }}>※ トークン量×モデル単価からの概算です。正確な請求額は各AIプロバイダのダッシュボードをご確認ください。</div>
          </>
        )}
      </div>

      <StaffManager rows={staff.rows} fromTable={staff.fromTable} />
    </div>
  );
}
