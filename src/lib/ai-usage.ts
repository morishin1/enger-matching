import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { estCostUsd, type Usage } from "./llm";

export const YEN_PER_USD = 150; // 表示用の概算レート

/** AI呼び出しの使用量を記録（service role、失敗は無視）。account は利用者(メール)。 */
export async function logUsage(feature: string, model: string, usage: Usage, account?: string | null) {
  try {
    const admin = engerAdmin();
    const row: Record<string, any> = {
      feature, model,
      input_tokens: usage.input, output_tokens: usage.output,
      cost_usd: estCostUsd(model, usage),
    };
    if (account) row.account = account;
    let r: any = await admin.from("ai_usage").insert(row);
    // account 列が未追加（SQL未実行）でも落ちないようフォールバック
    if (r.error && /account|column/i.test(r.error.message)) {
      delete row.account;
      await admin.from("ai_usage").insert(row);
    }
  } catch { /* テーブル未作成等は無視 */ }
}

/** 当日(ローカル0時以降)に、そのアカウントが該当機能を実行した回数。制限判定用。 */
export async function countTodayUsage(feature: string, account: string): Promise<number> {
  try {
    const admin = engerAdmin();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const res: any = await admin.from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("feature", feature).eq("account", account)
      .gte("created_at", start.toISOString());
    if (res.error) return 0; // 列/テーブル未整備時は制限せず通す（フェイルオープン）
    return res.count ?? 0;
  } catch { return 0; }
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

export type CostReport = {
  available: boolean;
  thisMonth: { label: string; count: number; usd: number };
  lastMonth: { label: string; count: number; usd: number };
  byFeature: { feature: string; count: number; usd: number }[]; // 今月分（ENGER内蔵）
  providers: { provider: string; label: string; count: number; usd: number }[]; // 今月分（内蔵/Gemini等）
};

const PROVIDER_LABEL: Record<string, string> = { internal: "ENGER内蔵AI", anthropic: "ENGER内蔵AI（Anthropic）", openai: "ENGER内蔵AI（OpenAI）", google: "Gemini（GAS）", gemini: "Gemini（GAS）" };
export const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p;
const isExternal = (p: string) => p === "google" || p === "gemini";

/** ダッシュボード用：今月・前月のAIコスト（ENGER内蔵AI＋Gemini(GAS)を合算）。 */
export async function getCostReport(): Promise<CostReport> {
  const empty: CostReport = { available: false, thisMonth: { label: "", count: 0, usd: 0 }, lastMonth: { label: "", count: 0, usd: 0 }, byFeature: [], providers: [] };
  if (!dbConfigured) return empty;
  try {
    const sb = engerClient();
    const now = new Date();
    const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const ym = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}`;
    // provider 列が無い環境でも落ちないようフォールバック
    let res: any = await sb.from("ai_usage").select("feature, provider, cost_usd, created_at").gte("created_at", lastStart.toISOString()).limit(20000);
    if (res.error) res = await sb.from("ai_usage").select("feature, cost_usd, created_at").gte("created_at", lastStart.toISOString()).limit(20000);
    if (res.error) return empty;
    const rows = res.data ?? [];
    const tm = { label: ym(thisStart), count: 0, usd: 0 };
    const lm = { label: ym(lastStart), count: 0, usd: 0 };
    const fmap = new Map<string, { count: number; usd: number }>();
    const pmap = new Map<string, { count: number; usd: number }>();
    for (const r of rows) {
      const usd = Number(r.cost_usd) || 0;
      const d = new Date(r.created_at);
      if (d >= thisStart) {
        tm.count++; tm.usd += usd;
        const prov = (r.provider as string) || "internal";
        const pm = pmap.get(prov) ?? { count: 0, usd: 0 }; pm.count++; pm.usd += usd; pmap.set(prov, pm);
        if (!isExternal(prov)) { // 機能別内訳は内蔵AIのみ（Geminiはprovider側で見る）
          const fk = r.feature || "other";
          const fm = fmap.get(fk) ?? { count: 0, usd: 0 }; fm.count++; fm.usd += usd; fmap.set(fk, fm);
        }
      } else if (d >= lastStart) { lm.count++; lm.usd += usd; }
    }
    const byFeature = [...fmap.entries()].map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.usd - a.usd);
    const providers = [...pmap.entries()].map(([provider, v]) => ({ provider, label: providerLabel(provider), ...v })).sort((a, b) => b.usd - a.usd);
    return { available: true, thisMonth: tm, lastMonth: lm, byFeature, providers };
  } catch { return empty; }
}

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
