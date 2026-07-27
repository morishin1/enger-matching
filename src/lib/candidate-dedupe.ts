/**
 * 0725改善指示書：人材CSV取込の重複判定（6条件）。
 *
 * 従来の「同姓同名は統合」は氏名のみの判定だったため、SES業界で日常的な
 * イニシャル氏名の衝突（TS/MS…）で **別人が登録されず消える** 事故が起きていた。
 * 本モジュールは指示書 §3 の6条件（OR）で「登録済み」を判定する：
 *
 *   1. 氏名＋所属会社＋年代＋単価
 *   2. 氏名＋所属会社＋最寄駅
 *   3. 氏名＋連絡先ドメイン＋年代＋単価
 *   4. 氏名＋連絡先ドメイン＋最寄駅
 *   5. 氏名＋スキルシートのリンク
 *   6. 氏名＋年代＋居住地＋単価（会社・連絡先を含まないのは意図的：別会社経由の同一人材の検出）
 *
 * 重要ルール：
 *   - 条件を構成する項目が（どちらか一方でも）空欄なら、その条件は判定せずスキップ（§3.3）。
 *     空欄同士を「一致」とみなすと、最寄駅が空欄の10名が全員同一人物になる重大事故になる。
 *   - 連絡先は＠より後ろ（ドメイン）だけを小文字で比較。＠より前は使わない（§3.2）。
 *   - 単価は数値として下限・上限の両方を比較（§3.4）。
 *   - 迷う場合は「重複を許す側」（＝別人として登録する側）に倒す（§1）。
 *
 * クライアント（プレビュー画面）とサーバ（取込処理）の両方から使う純粋ロジック。
 */

/** 「未入力」とみなす文字列（指示書 §5.2 の明示リスト）。判定のスキップと補完対象の両方でこの定義を使う。 */
const BLANKISH_EXACT = new Set([
  "", "不明", "未定", "未設定", "要確認", "なし",
  "－", "-", "―", "ー", "—", "‐", "/", "／",
]);

/** 空欄（未入力）か。前後の半角/全角空白を除去してから判定する。 */
export function isBlankish(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).replace(/^[\s　]+|[\s　]+$/g, "");
  return BLANKISH_EXACT.has(s);
}

/** 比較用に正規化した文字列（空欄は ""）。前後の空白除去のみ（完全一致比較・§3.4）。 */
function cmp(v: unknown): string {
  if (isBlankish(v)) return "";
  return String(v).replace(/^[\s　]+|[\s　]+$/g, "");
}

/** 連絡先メールアドレスからドメイン部（＠より後ろ）を小文字で取り出す。無ければ ""。 */
export function emailDomain(v: unknown): string {
  const s = cmp(v);
  const at = s.lastIndexOf("@");
  if (at < 0 || at === s.length - 1) return "";
  return s.slice(at + 1).toLowerCase();
}

/** 単価テキスト（"¥65万" / "70〜80万" / "スキル見合い"…）から数値レンジを取り出す。
 *  数値が無ければ null（＝空欄扱いで単価条件はスキップ）。数値1つなら下限=上限。 */
export function rateRangeOf(rate: unknown, salaryMin?: unknown, salaryMax?: unknown): { min: number; max: number } | null {
  const lo = typeof salaryMin === "number" && isFinite(salaryMin) ? salaryMin : null;
  const hi = typeof salaryMax === "number" && isFinite(salaryMax) ? salaryMax : null;
  if (lo != null || hi != null) return { min: lo ?? hi!, max: hi ?? lo! };
  const s = cmp(rate);
  if (!s) return null;
  const nums = (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0 && n < 1000);
  if (nums.length === 0) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** 判定に使う片側（CSV行 or 既存レコード）の正規化ビュー。 */
export type DedupeSide = {
  name: string;          // 氏名（空なら判定不能）
  company: string;       // 所属会社
  ageBand: string;       // 年代
  station: string;       // 最寄駅
  residence: string;     // 居住地
  rate: { min: number; max: number } | null; // 単価（数値レンジ。無ければ null）
  domain: string;        // 連絡先ドメイン（＠より後ろ・小文字）
  sheetUrl: string;      // スキルシートのリンク
};

/** CSV行（CandidateInput 相当）から判定ビューを作る。 */
export function sideFromCsv(r: {
  name?: string | null; company?: string | null; age_band?: string | null;
  location?: string | null; residence?: string | null;
  rate?: string | null; rate_num?: number | null;
  contact_email?: string | null; email?: string | null;
  skill_sheet_url?: string | null;
}): DedupeSide {
  return {
    name: cmp(r.name),
    company: cmp(r.company),
    ageBand: cmp(r.age_band),
    station: cmp(r.location),
    residence: cmp(r.residence),
    rate: rateRangeOf(r.rate) ?? (typeof r.rate_num === "number" && isFinite(r.rate_num) ? { min: r.rate_num, max: r.rate_num } : null),
    domain: emailDomain(r.contact_email) || emailDomain(r.email),
    sheetUrl: cmp(r.skill_sheet_url),
  };
}

/** 既存レコード（enger.candidates の行）から判定ビューを作る。 */
export function sideFromDb(row: {
  name?: string | null; source_company?: string | null; company?: string | null;
  age_band?: string | null; location?: string | null; residence?: string | null;
  rate?: string | null; rate_num?: number | null; salary_min?: number | null; salary_max?: number | null;
  contact_email?: string | null; email?: string | null; skill_sheet_url?: string | null;
}): DedupeSide {
  return {
    name: cmp(row.name),
    company: cmp(row.source_company) || cmp(row.company),
    ageBand: cmp(row.age_band),
    station: cmp(row.location),
    residence: cmp(row.residence),
    rate: rateRangeOf(row.rate, row.salary_min ?? undefined, row.salary_max ?? undefined)
      ?? (typeof row.rate_num === "number" && isFinite(row.rate_num) ? { min: row.rate_num, max: row.rate_num } : null),
    domain: emailDomain(row.contact_email) || emailDomain(row.email),
    sheetUrl: cmp(row.skill_sheet_url),
  };
}

/** 単価一致（両側に数値があり、下限・上限とも一致）。どちらかが null なら「空欄」＝条件スキップ。 */
function rateEq(a: DedupeSide["rate"], b: DedupeSide["rate"]): boolean | null {
  if (!a || !b) return null;
  return a.min === b.min && a.max === b.max;
}
/** 文字列一致。どちらかが空欄なら null（＝条件スキップ）。 */
function strEq(a: string, b: string): boolean | null {
  if (!a || !b) return null;
  return a === b;
}
/** ドメイン一致（既に小文字化済み）。 */
function domEq(a: string, b: string): boolean | null {
  if (!a || !b) return null;
  return a === b;
}

/**
 * 6条件を判定し、成立した条件番号の配列を返す（空配列＝別人）。
 * 各条件は AND（すべて一致）、条件間は OR。構成項目が空欄の条件はスキップ（null 伝播）。
 */
export function matchConditions(a: DedupeSide, b: DedupeSide): number[] {
  // 氏名は全条件の共通項。どちらか空欄なら判定不能＝別人扱い。
  if (!a.name || !b.name || a.name !== b.name) return [];
  const hit: number[] = [];
  const and = (...parts: Array<boolean | null>): boolean => parts.every((p) => p === true);
  // 1. 氏名＋所属会社＋年代＋単価
  if (and(strEq(a.company, b.company), strEq(a.ageBand, b.ageBand), rateEq(a.rate, b.rate))) hit.push(1);
  // 2. 氏名＋所属会社＋最寄駅
  if (and(strEq(a.company, b.company), strEq(a.station, b.station))) hit.push(2);
  // 3. 氏名＋連絡先ドメイン＋年代＋単価
  if (and(domEq(a.domain, b.domain), strEq(a.ageBand, b.ageBand), rateEq(a.rate, b.rate))) hit.push(3);
  // 4. 氏名＋連絡先ドメイン＋最寄駅
  if (and(domEq(a.domain, b.domain), strEq(a.station, b.station))) hit.push(4);
  // 5. 氏名＋スキルシートのリンク
  if (and(strEq(a.sheetUrl, b.sheetUrl))) hit.push(5);
  // 6. 氏名＋年代＋居住地＋単価（会社・連絡先は意図的に含めない）
  if (and(strEq(a.ageBand, b.ageBand), strEq(a.residence, b.residence), rateEq(a.rate, b.rate))) hit.push(6);
  return hit;
}

/** 補完（§5）対象のフィールドと日本語ラベル。既存が空欄/不明・CSVに値があるものだけ埋める。 */
export const FILLABLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "title", label: "職種" },
  { key: "company", label: "所属会社" },
  { key: "source_company", label: "所属会社" },
  { key: "affiliation", label: "所属区分" },
  { key: "rate", label: "単価" },
  { key: "rate_num", label: "単価（数値）" },
  { key: "avail", label: "稼働開始" },
  { key: "location", label: "最寄駅" },
  { key: "residence", label: "居住地" },
  { key: "exp", label: "経験" },
  { key: "remote_pref", label: "リモート希望" },
  { key: "age_band", label: "年代" },
  { key: "nationality", label: "国籍" },
  { key: "rank", label: "ランク" },
  { key: "skill_level", label: "スキルレベル" },
  { key: "japanese_level", label: "日本語レベル" },
  { key: "comm", label: "コミュニケーション力" },
  { key: "skill_sheet_url", label: "スキルシート" },
  { key: "email", label: "本人メール" },
  { key: "contact_email", label: "連絡先（窓口）" },
  { key: "contact_name", label: "窓口担当者" },
  { key: "source_mail_url", label: "元メールURL" },
  { key: "source_mail_at", label: "受信日時" },
];

/** 既存レコードに対して CSV 行で補完されるフィールドのラベル一覧（プレビュー表示・実補完の共通判定）。 */
export function fillableLabels(existing: Record<string, any>, csv: Record<string, any>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { key, label } of FILLABLE_FIELDS) {
    if (seen.has(label)) continue;
    const cur = existing[key];
    const nv = csv[key];
    if (isBlankish(cur) && !isBlankish(nv)) { out.push(label); seen.add(label); }
  }
  const curSkills = Array.isArray(existing.skills) ? existing.skills : [];
  const newSkills = Array.isArray(csv.skills) ? csv.skills : [];
  if (curSkills.length === 0 && newSkills.length > 0) out.push("スキル");
  return out;
}
