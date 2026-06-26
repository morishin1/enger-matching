// KPI推移の役割(アウトサイド/インサイド/テレアポ)定義（定数）。
//   役割の定義（KGI/KPIの文言・当日ボードで見る指標）はここに集約。
//   ※ サーバ専用の取得関数は kpi-funnel.ts に分離（このファイルはクライアントからも import 可能）。
import type { Metric } from "./kpi";

export type KpiRoleKey = "outside" | "inside" | "telapo";

export type RoleDef = {
  key: KpiRoleKey;
  label: string;
  summary: string;           // 役割の説明（責任範囲）
  kgi: string;               // KGI（成果）
  kgiUnit: string;           // 1名あたりの目安
  kpis: string[];            // KPI（やること）
  metrics: { metric: Metric; label: string }[]; // 当日ボードで強調する指標
  accent: string;
};

// 役割定義（立ち上げ期の目安。文言の調整はここを編集）。
export const ROLE_DEFS: RoleDef[] = [
  {
    key: "inside", label: "インサイド",
    summary: "人材と案件を ENGER でマッチングさせ面談まで進める。質のよい提案が必要。",
    kgi: "面談率 20% → 30%（提案→面談）", kgiUnit: "面談 1名 月4件",
    kpis: ["人材の供給 月20件", "提案の作成 1日20件", "提案は48h以内に返す"],
    metrics: [{ metric: "proposal", label: "提案" }, { metric: "schedule", label: "面談" }],
    accent: "#0b5cab",
  },
  {
    key: "outside", label: "アウトサイド",
    summary: "人材・案件の仕入れ。質の良い仕入れをして ENGER に登録。提案後の合格を目指す（押し決める力）。",
    kgi: "合格率 33%（面談→稼働）", kgiUnit: "稼働 1名 月2件",
    kpis: ["打ち合わせ 1日3件", "案件の仕入れ 月30件", "面談 → クロージング（合格）"],
    metrics: [{ metric: "schedule", label: "面談" }, { metric: "deal", label: "合格/稼働" }],
    accent: "#067647",
  },
  {
    key: "telapo", label: "テレアポ（バイト）",
    summary: "インサイドの面談率を下支え。",
    kgi: "独自KGIなし", kgiUnit: "",
    kpis: ["架電 1日40〜80件", "人材の所属確認", "面談アポの調整"],
    metrics: [{ metric: "contact", label: "コンタクト" }],
    accent: "#b45309",
  },
];

export const ROLE_LABEL: Record<KpiRoleKey, string> = { outside: "アウトサイド", inside: "インサイド", telapo: "テレアポ" };

// 読み方（運用メモ）。
export const FUNNEL_NOTES = [
  "インサイドが「提案→面談」まで、アウトサイドが「面談→稼働」まで責任を持つ。",
  "稼働が出ない時は、提案・面談・成約のどこで詰まったかを数字で見る。",
  "面談率を 20→30% に上げると、同じ4稼働を少ない提案で達成できる（負荷が減る）。",
  "数値は「3面談で1稼働」「月4稼働」を起点にした立ち上げ期の目安。実績が出たら調整。",
];

export type FunnelTarget = { won: number; meetingRate: number; passRate: number };
export const DEFAULT_FUNNEL_TARGET: FunnelTarget = { won: 4, meetingRate: 0.2, passRate: 0.33 };

/** ファネル目標から各段の目標件数を逆算（稼働→面談→提案）。 */
export function funnelTargetCounts(t: FunnelTarget): { proposal: number; meeting: number; won: number } {
  const meeting = t.passRate > 0 ? Math.round(t.won / t.passRate) : 0;
  const proposal = t.meetingRate > 0 ? Math.round(meeting / t.meetingRate) : 0;
  return { proposal, meeting, won: t.won };
}
