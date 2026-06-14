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

// 「不明」に倒すべき値（国名ではなく、不問/未確認/区切り記号など）。
//   例：取り込み時に案件の「国籍不問」が人材側へ紛れ込むと外国籍に誤分類されるため明示的に弾く。
const CAND_NAT_UNKNOWN_RE = /不問|問わ|未確認|未記入|未定|不明|要確認|該当な|^なし$|^[-‐–—―ー･・\/\s]+$|^n\/?a$/i;

/** 候補者の nationality 文字列を 3 区分に分類。 */
export function classifyCandNationality(value?: string | null): CandNat {
  const s = (value ?? "").trim();
  if (!s) return "unknown";
  if (/日本|jp\b|jpn|japan/i.test(s)) return "japan";
  if (CAND_NAT_UNKNOWN_RE.test(s)) return "unknown"; // 「国籍不問」等は外国籍ではなく不明扱い
  return "foreign";
}

// ── 人材 nationality 列の SQL(ilike) 近似フィルタ用キーワード ─────────────
//   表示バッジ classifyCandNationality と「外国籍」フィルタを整合させるために使う。
//   外国籍＝値あり ∧ 日本系でない ∧ 「不明」に倒す語を含まない。
//   ※ ここに挙げるのは国名に紛れ込まない部分文字列のみ（CAND_NAT_UNKNOWN_RE に対応）。
//     symbol のみ・"n/a" 等のアンカー一致は ilike だと国名を誤除外するため含めない。
export const CAND_NAT_UNKNOWN_SQL_KEYS = ["不問", "問わ", "未確認", "未記入", "未定", "不明", "要確認", "該当な", "なし"] as const;

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

// ── 案件の年代（年齢）制限 ─────────────────────────────────────────────
//   案件には専用カラムが無いため、本文(detail+title)から年齢制限の記述を best-effort で抽出する。
//   ・open    : 「年齢不問」等、明示的に制限なし
//   ・limited : 「〜39歳」「30代前半まで」等の制限あり（label に抽出した表現を入れる）
//   ・unknown : 記載が見当たらない（要確認）
export type JobAge = "limited" | "open" | "unknown";
export const JOB_AGE_LABEL: Record<JobAge, string> = { limited: "年齢制限あり", open: "年齢不問", unknown: "不明" };
export const JOB_AGE_TONE: Record<JobAge, Tone> = { limited: RED, open: GREEN, unknown: GRAY };

const JOB_AGE_OPEN_RE = /年齢不問|年齢を?問わ(ない|ず)|年齢制限な[しい]/;
// 年齢制限の表現パターン（数字は 20〜69 を想定して [2-6]\d に限定し誤検出を抑える）。
const JOB_AGE_PATTERNS: RegExp[] = [
  /[2-6]\d\s*歳?\s*[〜～~－\-]\s*[2-6]\d\s*歳/,        // 25〜35歳 / 25-35歳
  /(?:〜|～|~)\s*[2-6]\d\s*歳(?:まで|以下|未満|迄)?/,  // 〜39歳
  /[2-6]\d\s*歳\s*(?:まで|以下|未満|迄|以上)/,          // 35歳まで / 30歳以上
  /(?:20|30|40|50|60)\s*代(?:前半|後半|半ば|まで|以下)?/, // 30代前半 / 40代まで
];

/** 案件本文（detail + title など）から年齢制限を抽出。label には見つかった表現（例「〜39歳」）を返す。 */
export function classifyJobAge(...texts: (string | null | undefined)[]): { cat: JobAge; label: string } {
  const t = texts.filter(Boolean).join(" ");
  if (!t) return { cat: "unknown", label: JOB_AGE_LABEL.unknown };
  if (JOB_AGE_OPEN_RE.test(t)) return { cat: "open", label: JOB_AGE_LABEL.open };
  for (const re of JOB_AGE_PATTERNS) {
    const m = t.match(re);
    if (m) return { cat: "limited", label: m[0].replace(/\s+/g, "") };
  }
  return { cat: "unknown", label: JOB_AGE_LABEL.unknown };
}
