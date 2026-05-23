import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { estCostUsd, type Usage } from "./llm";

export const YEN_PER_USD = 150; // 表示用の概算レート

/** AI呼び出しの使用量を記録（service role、失敗は無視）。 */
export async function logUsage(feature: string, model: string, usage: Usage) {
  try {
    const admin = engerAdmin();
    await admin.from("ai_usage").insert({
      feature, model,
      input_tokens: usage.input, output_tokens: usage.output,
      cost_usd: estCostUsd(model, usage),
    });
  } catch { /* テーブル未作成等は無視 */ }
}

export type UsageStats = {
  available: boolean;
  total: { count: number; usd: number };
  thisMonth: { count: number; usd: number };
  byFeature: { feature: string; count: number; usd: number }[];
  daily: { date: string; usd: number; count: number }[]; // 直近30日
};

const FEATURE_LABEL: Record<string, string> = { proposal: "提案文生成", meeting: "打合せAI分析", rerank: "AI再ランキング", brief: "今日のAIブリーフィング", billing: "請求・勤怠AI抽出", coach: "日報AIコーチング", review: "日報AI講評" };
export const featureLabel = (f: string) => FEATURE_LABEL[f] ?? f;

/** 設定ページ用の集計（直近の使用量）。 */
export async function getUsageStats(): Promise<UsageStats> {
  const empty: UsageStats = { available: false, total: { count: 0, usd: 0 }, thisMonth: { count: 0, usd: 0 }, byFeature: [], daily: [] };
  if (!dbConfigured) return empty;
  try {
    const sb = engerClient();
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await sb.from("ai_usage").select("feature, cost_usd, created_at").gte("created_at", since).limit(5000);
    if (error) return empty;
    const rows = data ?? [];
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const byFeatureMap = new Map<string, { count: number; usd: number }>();
    const dailyMap = new Map<string, { usd: number; count: number }>();
    let total = { count: 0, usd: 0 }, thisMonth = { count: 0, usd: 0 };
    for (const r of rows) {
      const usd = Number(r.cost_usd) || 0;
      total.count++; total.usd += usd;
      const d = new Date(r.created_at);
      if (d >= monthStart) { thisMonth.count++; thisMonth.usd += usd; }
      const fk = r.feature || "other";
      const fm = byFeatureMap.get(fk) ?? { count: 0, usd: 0 }; fm.count++; fm.usd += usd; byFeatureMap.set(fk, fm);
      const dk = `${d.getMonth() + 1}/${d.getDate()}`;
      const dm = dailyMap.get(dk) ?? { usd: 0, count: 0 }; dm.usd += usd; dm.count++; dailyMap.set(dk, dm);
    }
    // 直近30日の日付列を生成（空日も0で）
    const daily: UsageStats["daily"] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const k = `${d.getMonth() + 1}/${d.getDate()}`;
      const m = dailyMap.get(k) ?? { usd: 0, count: 0 };
      daily.push({ date: k, usd: m.usd, count: m.count });
    }
    const byFeature = [...byFeatureMap.entries()].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.usd - a.usd);
    return { available: true, total, thisMonth, byFeature, daily };
  } catch {
    return empty;
  }
}
