// フリーランス(public.profiles) → 人材マスタ(enger.candidates) への項目マッピング（管理NO #250）。
//   ・LP 側の実カラム名が環境で異なるため、行の全列から名前パターンで動的に拾う（#239 と同方針）。
//   ・空欄（未登録）はそのまま空欄に倒す（初期テキストやエラーにしない）。
import { classifyCandNationality, CAND_NAT_LABEL } from "./nationality";

/** 年齢(数値) → 年代区分（例：36 → "30代後半"）。範囲外/不明は空文字。 */
export function ageToBand(age: number | null | undefined): string {
  const n = Number(age);
  if (!Number.isFinite(n) || n < 10 || n > 99) return "";
  const decade = Math.floor(n / 10) * 10;
  const half = (n % 10) < 5 ? "前半" : "後半";
  return `${decade}代${half}`;
}

/** 希望単価 下限/上限 → "50万〜" / "50万〜60万" / "〜60万" / 空文字。 */
export function formatRateRange(low: number | null | undefined, high: number | null | undefined): string {
  const lo = Number(low), hi = Number(high);
  const hasLo = Number.isFinite(lo) && lo > 0;
  const hasHi = Number.isFinite(hi) && hi > 0;
  if (hasLo && hasHi) return `${lo}万〜${hi}万`;
  if (hasLo) return `${lo}万〜`;
  if (hasHi) return `〜${hi}万`;
  return "";
}

/** リモート希望を人材マスタの3区分に正規化（フル/一部/出社）。空/不明は空文字。
 *  boolean（true=リモート可）も受ける。 */
export function normalizeRemote(raw: unknown): string {
  if (raw === true) return "一部リモート可";
  if (raw === false) return "出社可";
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/フル|full|完全|フルリモート/i.test(s)) return "フルリモート希望";
  if (/一部|hybrid|ハイブリッド|リモート|在宅|remote|可|ok/i.test(s)) return "一部リモート可";
  if (/出社|常駐|onsite|office|不可|ng/i.test(s)) return "出社可";
  return "";
}

/** 国籍を人材マスタの3区分（日本国籍/外国籍/不明）に正規化。空は空文字。 */
export function normalizeNationality(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return CAND_NAT_LABEL[classifyCandNationality(s)];
}

// ── 動的スキャン（LP の列名差異を吸収）────────────────────────────────
const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const firstNum = (v: unknown): number | null => {
  const m = String(v ?? "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
};
function pickByKey(row: any, re: RegExp, validate?: (v: any) => boolean): any {
  for (const k of Object.keys(row ?? {})) {
    if (!re.test(k)) continue;
    const v = row[k];
    if (v == null || str(v) === "") continue;
    if (validate && !validate(v)) continue;
    return v;
  }
  return null;
}

/** profiles 行（select * 取得）から #250 のマッピング元データを抽出する。
 *  既知の列（estimated_pay_low/high・skills・email）を優先しつつ、未知の列名は名前パターンで拾う。 */
export function extractFreelanceFields(p: any): {
  age: number | null;
  nationality: string;     // 生値（後で normalizeNationality）
  nearestStation: string;
  desiredJob: string;
  remote: unknown;         // 生値（後で normalizeRemote）
  rateMin: number | null;
  rateMax: number | null;
} {
  // 年齢：age/年齢 列、無ければ生年月日(birth/dob/生年)から概算。
  let age = firstNum(pickByKey(p, /(^|_)age($|_)|年齢/i, (v) => firstNum(v) != null && firstNum(v)! <= 99));
  if (age == null) {
    const birth = str(pickByKey(p, /birth|生年|dob|誕生/i));
    const ym = birth.match(/(\d{4})/);
    if (ym) { const y = Number(ym[1]); if (y > 1900 && y < 2100) age = new Date().getFullYear() - y; }
    if (age != null && (age < 10 || age > 99)) age = null;
  }
  const nationality = str(pickByKey(p, /nationality|国籍/i));
  const nearestStation = str(pickByKey(p, /nearest.*station|station|最寄|最寄り駅/i));
  // 希望職種：desired/希望 + job/職種/position/occupation。display_name や case を誤検出しないよう厳しめ。
  const desiredJob = str(pickByKey(p, /(desired|希望|wish|want).*(job|title|position|occupation|role|職種)|希望職種|職種|occupation/i));
  const remote = pickByKey(p, /remote|リモート|在宅|telework/i);
  // 希望単価 下限/上限。LP の希望単価列を優先し、無ければ GitHub 推定単価(estimated_pay)へフォールバック。
  const rateMin = firstNum(pickByKey(p, /(rate|単価|salary|price|pay).*(min|low|下限|min_)|(min|low|下限).*(rate|単価|salary|pay)|希望単価.*下限|desired.*pay.*low/i))
    ?? firstNum(p?.estimated_pay_low) ?? firstNum(p?.estimated_pay_mid);   // 単一のGitHub推定単価(mid)しか無い場合の下限フォールバック
  const rateMax = firstNum(pickByKey(p, /(rate|単価|salary|price|pay).*(max|high|上限|max_)|(max|high|上限).*(rate|単価|salary|pay)|希望単価.*上限|desired.*pay.*high/i))
    ?? firstNum(p?.estimated_pay_high);
  return { age, nationality, nearestStation, desiredJob, remote, rateMin, rateMax };
}

/** スキルカード（技術スタック）を抽出。profiles.skills（jsonb 配列）を最優先、無ければ skill_card 系の列。 */
export function extractSkillCard(p: any): string[] {
  const fromArr = (v: any): string[] =>
    Array.isArray(v) ? v.map((s: any) => (typeof s === "string" ? s : str(s?.name))).map((s) => s.trim()).filter(Boolean) : [];
  if (Array.isArray(p?.skills) && p.skills.length) return fromArr(p.skills);
  for (const k of Object.keys(p ?? {})) {
    if (/skill_?card|skillcard|tech_?stack|techstack|スキルカード|技術スタック/i.test(k) && Array.isArray(p[k])) {
      const arr = fromArr(p[k]); if (arr.length) return arr;
    }
  }
  return [];
}
