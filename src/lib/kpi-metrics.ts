// 複数KPI項目（メトリクス）の定義カタログと、月→週→日のペース算出ヘルパ。
//   - 定番カタログ：稼働化・提案・架電・面談・アポ・返信
//   - カスタム項目：キーを "c:" プレフィックスで持つ（ラベル＝キーの残り）
//   ※ クライアント/サーバ両方から import 可能な純粋モジュール（DB依存なし）。

export type KpiMetric = { key: string; label: string; unit: string };

/** 稼働化（KGIの中心）。person_kgi.placement_target にミラーされる特別キー。 */
export const PLACEMENT_KEY = "placement";

/** 定番カタログ（表示順）。稼働化を先頭に固定。 */
export const KPI_CATALOG: KpiMetric[] = [
  { key: "placement",   label: "稼働化", unit: "件" },
  { key: "proposal",    label: "提案",   unit: "件" },
  { key: "call",        label: "架電",   unit: "件" },
  { key: "meeting",     label: "面談",   unit: "件" },
  { key: "appointment", label: "アポ獲得", unit: "件" },
  { key: "reply",       label: "返信",   unit: "件" },
];

const CATALOG_BY_KEY = new Map(KPI_CATALOG.map((m) => [m.key, m] as const));

export const isCustomKey = (key: string) => key.startsWith("c:");
export const makeCustomKey = (label: string) => `c:${label.trim()}`;

/** キーからメトリクス定義を解決（カスタムは保存済みラベル/単位を優先）。 */
export function resolveMetric(key: string, label?: string | null, unit?: string | null): KpiMetric {
  const cat = CATALOG_BY_KEY.get(key);
  if (cat) return cat;
  const lbl = (label && label.trim()) || (isCustomKey(key) ? key.slice(2) : key);
  return { key, label: lbl, unit: (unit && unit.trim()) || "件" };
}

/** 月次目標から 月/週/日 のペースを算出（活動量メトリクス向けの単純按分）。 */
export function cadence(monthTarget: number, bizDays: number): { month: number | null; week: number | null; day: number | null } {
  if (!monthTarget || monthTarget <= 0) return { month: null, week: null, day: null };
  return {
    month: monthTarget,
    week: Math.ceil(monthTarget / 4.33),
    day: Math.ceil(monthTarget / Math.max(1, bizDays)),
  };
}
