// 所属区分（稼働・請求で共通）。コードで保存し、表示はラベル。
//   PP = プロパー（自社社員。原価=給与なので一般には非表示）
//   BP = ビジネスパートナー（協力会社）
//   FL = フリーランス（個人事業主）

export const AFFILIATIONS = [
  { code: "PP", label: "PP（プロパー）", short: "PP" },
  { code: "BP", label: "BP（ビジネスパートナー）", short: "BP" },
  { code: "FL", label: "FL（フリーランス）", short: "FL" },
] as const;

export type AffiliationCode = (typeof AFFILIATIONS)[number]["code"];

/** 旧表記（プロパー/フリーランス 等）→ コードへ正規化。 */
export function normalizeAffiliation(v?: string | null): AffiliationCode | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (AFFILIATIONS.some((a) => a.code === s)) return s as AffiliationCode;
  if (/プロパー|proper|社員/i.test(s)) return "PP";
  if (/フリー|個人事業|freelance|fl/i.test(s)) return "FL";
  if (/BP|ビジネスパートナー|partner|協力/i.test(s)) return "BP";
  return null;
}

/** 表示用の短いラベル（PP/BP/FL）。 */
export function affiliationShort(v?: string | null): string {
  const c = normalizeAffiliation(v);
  return c ?? "未設定";
}
