// ダッシュボードの「登録数・KPIの推移」用の時系列集計。
//
//   フリーランス登録（public.profiles）／人材登録（enger.candidates）／
//   案件登録（enger.jobs）／提案（enger.proposals）／成約（enger.engagements）
//   の created_at を直近12ヶ月ぶん取得し、週次（直近12週・月曜起点）と
//   月次（直近12ヶ月）にバケット集計して返す。
//
//   ・取得は created_at のみ・1000件ページング（Data API の Max rows 対策）。
//   ・テーブル未整備/権限エラーはそのシリーズだけ0で続行（fail-soft）。
//   ・1時間キャッシュ（unstable_cache）。ダッシュボード表示のたびの重い集計を避ける。

import { unstable_cache } from "next/cache";
import { engerAdmin, publicAdmin, dbConfigured } from "./supabase";

export type TrendSeries = {
  key: string;
  label: string;
  color: string;
  weekly: number[];   // 直近12週（古→新）
  monthly: number[];  // 直近12ヶ月（古→新）
  thisWeek: number;
  thisMonth: number;
  total12m: number;
};

export type TrendData = {
  weekLabels: string[];   // "M/D"（週の月曜）
  monthLabels: string[];  // "M月"
  series: TrendSeries[];
  generatedAt: string;
};

const WEEKS = 12;
const MONTHS = 12;
const PAGE = 1000;
const MAX_PAGES = 30; // 1シリーズ最大3万行（それ以上は古い分が欠けるだけ・上限明示）

/** 週の月曜0:00（ローカル=サーバUTCで統一。表示ラベル用途なのでTZ厳密性より一貫性を優先）。 */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

async function fetchCreatedAts(
  q: (from: number, to: number) => Promise<{ data: any[] | null; error: any }>,
): Promise<number[]> {
  const out: number[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await q(p * PAGE, p * PAGE + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      const t = new Date((r as any).created_at).getTime();
      if (Number.isFinite(t)) out.push(t);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function fetchTrends(): Promise<TrendData> {
  const now = new Date();
  // 月次12ヶ月ぶんの起点（当月を含む12ヶ月）
  const monthStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1);
  // 週次12週ぶんの起点（今週を含む12週・月曜起点）
  const weekStart = mondayOf(new Date(now.getTime() - (WEEKS - 1) * 7 * 86400000));
  const sinceIso = new Date(Math.min(monthStart.getTime(), weekStart.getTime())).toISOString();

  // バケット境界（古→新）
  const weekEdges: number[] = [];
  for (let i = 0; i < WEEKS; i++) weekEdges.push(weekStart.getTime() + i * 7 * 86400000);
  const monthEdges: number[] = [];
  for (let i = 0; i < MONTHS; i++) monthEdges.push(new Date(monthStart.getFullYear(), monthStart.getMonth() + i, 1).getTime());

  const weekLabels = weekEdges.map((t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; });
  const monthLabels = monthEdges.map((t) => { const d = new Date(t); return `${d.getMonth() + 1}月`; });

  const bucket = (times: number[]) => {
    const weekly = new Array(WEEKS).fill(0);
    const monthly = new Array(MONTHS).fill(0);
    for (const t of times) {
      // 週次
      if (t >= weekEdges[0]) {
        const wi = Math.min(WEEKS - 1, Math.floor((t - weekEdges[0]) / (7 * 86400000)));
        if (wi >= 0) weekly[wi]++;
      }
      // 月次
      if (t >= monthEdges[0]) {
        let mi = MONTHS - 1;
        for (let i = MONTHS - 1; i >= 0; i--) { if (t >= monthEdges[i]) { mi = i; break; } }
        monthly[mi]++;
      }
    }
    return { weekly, monthly };
  };

  // 各シリーズの取得クエリ（created_at のみ・since以降・fail-soft）
  const defs: { key: string; label: string; color: string; run: () => Promise<number[]> }[] = [
    {
      key: "freelance", label: "フリーランス登録", color: "#0095D9",
      run: () => fetchCreatedAts((f, t) => publicAdmin().from("profiles").select("created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).range(f, t) as any),
    },
    {
      key: "candidates", label: "人材登録", color: "#067647",
      run: () => fetchCreatedAts((f, t) => engerAdmin().from("candidates").select("created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).range(f, t) as any),
    },
    {
      key: "jobs", label: "案件登録", color: "#b45309",
      run: () => fetchCreatedAts((f, t) => engerAdmin().from("jobs").select("created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).range(f, t) as any),
    },
    {
      key: "proposals", label: "提案（マッチング）", color: "#7c3aed",
      run: () => fetchCreatedAts((f, t) => engerAdmin().from("proposals").select("created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).range(f, t) as any),
    },
    {
      key: "engagements", label: "成約・稼働", color: "#b42318",
      run: () => fetchCreatedAts((f, t) => engerAdmin().from("engagements").select("created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).range(f, t) as any),
    },
  ];

  const series: TrendSeries[] = [];
  for (const d of defs) {
    let times: number[] = [];
    try { times = await d.run(); } catch { /* テーブル未整備等は0で続行 */ }
    const b = bucket(times);
    series.push({
      key: d.key, label: d.label, color: d.color,
      weekly: b.weekly, monthly: b.monthly,
      thisWeek: b.weekly[WEEKS - 1] ?? 0,
      thisMonth: b.monthly[MONTHS - 1] ?? 0,
      total12m: b.monthly.reduce((a, v) => a + v, 0),
    });
  }

  return { weekLabels, monthLabels, series, generatedAt: new Date().toISOString() };
}

/** ダッシュボードの推移データ（1時間キャッシュ・タグ "dashboard-trends"）。 */
export const getDashboardTrends = unstable_cache(
  async (): Promise<TrendData | null> => {
    if (!dbConfigured) return null;
    try { return await fetchTrends(); } catch { return null; }
  },
  ["dashboard-trends"],
  { revalidate: 3600, tags: ["dashboard-trends"] },
);
