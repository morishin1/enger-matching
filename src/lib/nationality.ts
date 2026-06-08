// 国籍の読み取り・分類。クライアント/サーバ両用の純粋モジュール。
//   人材（候補者）: nationality フィールド → 日本国籍 / 外国籍 / 不明
//   案件（求人）  : detail+title の本文 → 日本国籍のみ / 国籍不問 / 不明
//   ※ 外国籍NGの案件を見落とさないよう、案件側「日本国籍のみ」は赤で強調する。

export type CandNat = "japan" | "foreign" | "unknown";
export type JobNat = "jp_only" | "open" | "unknown";

export const CAND_NAT_LABEL: Record<CandNat, string> = { japan: "日本国籍", foreign: "外国籍", unknown: "不明" };
export const JOB_NAT_LABEL: Record<JobNat, string> = { jp_only: "日本国籍のみ", open: "国籍不問", unknown: "不明" };

type Tone = { bg: string; fg: string; bd: string };
const GREEN: Tone = { bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc" };
const INDIGO: Tone = { bg: "#eef2ff", fg: "#3730a3", bd: "#c7d2fe" };
const RED: Tone = { bg: "#fdecef", fg: "#b42318", bd: "#f7c5cf" };
const GRAY: Tone = { bg: "#f3f4f6", fg: "#6b7280", bd: "#e5e7eb" };

export const CAND_NAT_TONE: Record<CandNat, Tone> = { japan: GREEN, foreign: INDIGO, unknown: GRAY };
// 案件は「日本国籍のみ（=外国籍NG）」を赤で警告、「国籍不問」を緑に。
export const JOB_NAT_TONE: Record<JobNat, Tone> = { jp_only: RED, open: GREEN, unknown: GRAY };

/** 候補者の nationality 文字列を 3 区分に分類。 */
export function classifyCandNationality(value?: string | null): CandNat {
  const s = (value ?? "").trim();
  if (!s) return "unknown";
  return /日本|jp\b|jpn|japan/i.test(s) ? "japan" : "foreign";
}

// 案件本文の国籍要件パターン。jp_only を先に判定（「外国籍不可」が open に誤判定されないように）。
const JOB_JP_ONLY_RE = /日本国籍|日本人(のみ|限定|に限る)|外国籍(不可|不可能|ng|お断り|×)|永住権.{0,3}(必須|必要)/i;
const JOB_OPEN_RE = /国籍不問|国籍を?問わ(ない|ず)|外国籍(歓迎|可|ok|相談|可能)|外国人(歓迎|可)|ビザ(支援|サポート)/i;

/** 案件本文（detail + title など）から国籍要件を 3 区分に分類。 */
export function classifyJobNationality(...texts: (string | null | undefined)[]): JobNat {
  const t = texts.filter(Boolean).join(" ");
  if (!t) return "unknown";
  if (JOB_JP_ONLY_RE.test(t)) return "jp_only";
  if (JOB_OPEN_RE.test(t)) return "open";
  return "unknown";
}

// ── サーバ側フィルタ（ilike）用キーワード ──────────────────────────────
//   案件は専用カラムが無く本文テキストで持つため、PostgREST の ilike で近似フィルタする。
//   表示バッジは classifyJobNationality（正確）／フィルタは下記キーワード（近似）。
export const JOB_NAT_SQL_KEYS = {
  jp_only: ["日本国籍", "外国籍不可", "外国籍NG", "外国籍お断り", "日本人のみ", "日本人限定", "永住権必須", "永住権が必要", "永住権必要"],
  open: ["国籍不問", "国籍を問わ", "国籍問わ", "外国籍歓迎", "外国籍可", "外国籍OK", "外国人歓迎", "外国人可", "ビザ支援", "ビザサポート"],
  // 「不明」判定用：これらの語が本文/タイトルに一切出てこない＝言及なし。
  mention: ["国籍", "永住権", "外国人", "日本人"],
} as const;
