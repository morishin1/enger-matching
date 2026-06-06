// 市場単価とトレンド係数の仮置き参考値（SES市場・東京中心の概観）。
//   ・median: 月額単価の中央値（万円）。SES案件で見かける一般的なレンジの中点を採用。
//   ・trend:  需要トレンド係数（1.0=横ばい / >1=拡大 / <1=縮小）。直近6〜12か月の感覚値。
//   ・demand: 引き合いの量感（high/med/low）。
//   ・track:  キャリア軸（frontend/backend/mobile/infra/data/ai/qa/pm/erp/ses_old）。
//
// あくまで参考値。実データに置き換えるなら DB（market_rates）に出して取り込み可能。
// 編集ルール：
//   - 1スキル1行。skill は正規化済みの表記（match.ts canon の戻り値と同じ）。
//   - 価格更新は四半期ごと。trend は四半期で±0.05程度の刻みで動かす想定。

export type MarketDemand = "high" | "med" | "low";
export type MarketTrack = "frontend" | "backend" | "mobile" | "infra" | "data" | "ai" | "qa" | "pm" | "erp" | "ses_old";

export type MarketRate = {
  skill: string;
  median: number;
  trend: number;
  demand: MarketDemand;
  track: MarketTrack;
  note?: string;
};

export const MARKET_RATES: MarketRate[] = [
  // Frontend
  { skill: "TypeScript",   median: 80, trend: 1.15, demand: "high", track: "frontend" },
  { skill: "React",        median: 75, trend: 1.10, demand: "high", track: "frontend" },
  { skill: "Next.js",      median: 80, trend: 1.20, demand: "high", track: "frontend" },
  { skill: "Vue",          median: 70, trend: 0.95, demand: "med",  track: "frontend" },
  { skill: "Nuxt",         median: 75, trend: 1.00, demand: "med",  track: "frontend" },
  { skill: "Svelte",       median: 78, trend: 1.10, demand: "low",  track: "frontend", note: "案件少だが高単価" },
  // Backend
  { skill: "Node.js",      median: 78, trend: 1.05, demand: "high", track: "backend" },
  { skill: "Python",       median: 78, trend: 1.10, demand: "high", track: "backend" },
  { skill: "Go",           median: 90, trend: 1.25, demand: "high", track: "backend", note: "拡大中・希少" },
  { skill: "Rust",         median: 95, trend: 1.30, demand: "med",  track: "backend", note: "高単価・案件はまだ薄い" },
  { skill: "Java",         median: 70, trend: 0.95, demand: "med",  track: "backend", note: "案件多いが単価頭打ち" },
  { skill: "Kotlin",       median: 80, trend: 1.10, demand: "med",  track: "backend" },
  { skill: "Ruby",         median: 75, trend: 0.90, demand: "med",  track: "backend" },
  { skill: "PHP",          median: 65, trend: 0.85, demand: "med",  track: "backend", note: "縮小傾向" },
  { skill: "C#",           median: 72, trend: 0.95, demand: "med",  track: "backend" },
  { skill: ".NET",         median: 72, trend: 0.95, demand: "med",  track: "backend" },
  { skill: "Spring",       median: 75, trend: 0.95, demand: "high", track: "backend" },
  { skill: "Django",       median: 80, trend: 1.05, demand: "med",  track: "backend" },
  { skill: "FastAPI",      median: 82, trend: 1.20, demand: "med",  track: "backend" },
  // Mobile
  { skill: "Swift",        median: 80, trend: 1.05, demand: "med",  track: "mobile" },
  { skill: "iOS",          median: 80, trend: 1.05, demand: "med",  track: "mobile" },
  { skill: "Android",      median: 78, trend: 1.00, demand: "med",  track: "mobile" },
  { skill: "Flutter",      median: 80, trend: 1.10, demand: "med",  track: "mobile" },
  // Infra / Cloud / SRE
  { skill: "AWS",          median: 85, trend: 1.15, demand: "high", track: "infra" },
  { skill: "GCP",          median: 85, trend: 1.10, demand: "med",  track: "infra" },
  { skill: "Azure",        median: 80, trend: 1.05, demand: "med",  track: "infra" },
  { skill: "Kubernetes",   median: 95, trend: 1.20, demand: "high", track: "infra", note: "K8s経験者は希少・高単価" },
  { skill: "Terraform",    median: 85, trend: 1.15, demand: "high", track: "infra" },
  { skill: "Docker",       median: 75, trend: 1.05, demand: "high", track: "infra" },
  { skill: "Linux",        median: 70, trend: 1.00, demand: "high", track: "infra" },
  { skill: "Network",      median: 70, trend: 0.95, demand: "med",  track: "infra" },
  { skill: "SRE",          median: 95, trend: 1.20, demand: "high", track: "infra" },
  // DB
  { skill: "PostgreSQL",   median: 75, trend: 1.05, demand: "med",  track: "infra" },
  { skill: "MySQL",        median: 70, trend: 0.95, demand: "med",  track: "infra" },
  { skill: "Oracle",       median: 75, trend: 0.85, demand: "med",  track: "infra", note: "縮小ぎみ・大手案件で堅調" },
  { skill: "SQL Server",   median: 70, trend: 0.90, demand: "med",  track: "infra" },
  // Data / DWH / Analytics
  { skill: "Snowflake",    median: 95, trend: 1.30, demand: "high", track: "data" },
  { skill: "BigQuery",     median: 90, trend: 1.20, demand: "high", track: "data" },
  { skill: "Databricks",   median: 95, trend: 1.25, demand: "med",  track: "data" },
  { skill: "dbt",          median: 90, trend: 1.25, demand: "med",  track: "data" },
  { skill: "Airflow",      median: 85, trend: 1.10, demand: "med",  track: "data" },
  { skill: "Kafka",        median: 90, trend: 1.20, demand: "med",  track: "data" },
  { skill: "Tableau",      median: 75, trend: 1.00, demand: "med",  track: "data" },
  // AI / ML / Gen-AI
  { skill: "PyTorch",      median: 100, trend: 1.35, demand: "high", track: "ai" },
  { skill: "TensorFlow",   median: 95,  trend: 1.05, demand: "med",  track: "ai" },
  { skill: "MLOps",        median: 100, trend: 1.30, demand: "med",  track: "ai" },
  { skill: "LangChain",    median: 100, trend: 1.40, demand: "high", track: "ai", note: "Gen-AI実装の中核" },
  { skill: "LLM",          median: 110, trend: 1.50, demand: "high", track: "ai", note: "経験者は破格" },
  { skill: "Generative AI", median: 110, trend: 1.50, demand: "high", track: "ai" },
  { skill: "RAG",          median: 105, trend: 1.45, demand: "high", track: "ai" },
  // QA / Test
  { skill: "QA",           median: 65, trend: 1.05, demand: "med",  track: "qa" },
  { skill: "Cypress",      median: 75, trend: 1.10, demand: "med",  track: "qa" },
  { skill: "Selenium",     median: 65, trend: 0.95, demand: "med",  track: "qa" },
  // PM / PMO
  { skill: "PM",           median: 85, trend: 1.00, demand: "high", track: "pm" },
  { skill: "PMO",          median: 80, trend: 1.00, demand: "high", track: "pm" },
  { skill: "PdM",          median: 90, trend: 1.10, demand: "med",  track: "pm" },
  // ERP / 業務系（縮小・横ばい層も明示）
  { skill: "SAP",          median: 90, trend: 1.00, demand: "med",  track: "erp" },
  { skill: "Salesforce",   median: 85, trend: 1.10, demand: "high", track: "erp" },
  { skill: "Apex",         median: 90, trend: 1.10, demand: "med",  track: "erp" },
  { skill: "LWC",          median: 90, trend: 1.10, demand: "med",  track: "erp" },
  // 旧来SES系（あえて入れて「育てない領域」を可視化）
  { skill: "VB",           median: 55, trend: 0.75, demand: "low",  track: "ses_old", note: "縮小：育成対象外" },
  { skill: "COBOL",        median: 65, trend: 0.70, demand: "low",  track: "ses_old", note: "縮小：保守需要のみ" },
  { skill: "Perl",         median: 55, trend: 0.70, demand: "low",  track: "ses_old", note: "縮小" },
];

const TRACK_LABEL: Record<MarketTrack, string> = {
  frontend: "フロントエンド",
  backend:  "バックエンド",
  mobile:   "モバイル",
  infra:    "インフラ/クラウド/SRE",
  data:     "データ基盤/分析",
  ai:       "AI/機械学習/生成AI",
  qa:       "QA/テスト",
  pm:       "PM/PMO/PdM",
  erp:      "ERP/業務系",
  ses_old:  "旧来SES（縮小）",
};
const DEMAND_LABEL: Record<MarketDemand, string> = { high: "高", med: "中", low: "低" };

export function trackLabel(t: MarketTrack): string { return TRACK_LABEL[t]; }
export function demandLabel(d: MarketDemand): string { return DEMAND_LABEL[d]; }

/** 名前一致でスキルの市場参考を返す（大文字小文字・記号の揺れに鈍感）。 */
const norm = (s: string) => s.toLowerCase().replace(/[\s\.\-_/]/g, "");
const MAP = new Map<string, MarketRate>(MARKET_RATES.map((r) => [norm(r.skill), r] as const));
export function lookupMarket(skill: string | null | undefined): MarketRate | null {
  if (!skill) return null;
  return MAP.get(norm(String(skill))) ?? null;
}

/** トラック別の集計（中央値・平均トレンド）。 */
export function trackStats(): { track: MarketTrack; label: string; count: number; medianAvg: number; trendAvg: number }[] {
  const groups = new Map<MarketTrack, MarketRate[]>();
  for (const r of MARKET_RATES) {
    const arr = groups.get(r.track) ?? [];
    arr.push(r); groups.set(r.track, arr);
  }
  return [...groups.entries()].map(([track, arr]) => ({
    track, label: TRACK_LABEL[track], count: arr.length,
    medianAvg: Math.round(arr.reduce((s, r) => s + r.median, 0) / arr.length),
    trendAvg:  +(arr.reduce((s, r) => s + r.trend, 0) / arr.length).toFixed(2),
  })).sort((a, b) => b.trendAvg - a.trendAvg);
}
