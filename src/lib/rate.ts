/**
 * 単価の表示を「〇〇万」に揃える（純粋関数）。
 *
 * ## なぜ要るのか
 * `candidates.rate` / `proposals.rate` は**自由入力のテキスト列**で、
 * 取り込み元によって書式がバラバラになっている。
 *
 *   "¥40" / "40" / "40万" / "400000" / "60〜70万" / "月80万円" / "-"
 *
 * これをそのまま画面へ出していたため、40万の人材が「¥40」と表示されていた
 * （管理NO #502）。数字だけを見て「40円」と読めてしまうので、
 * **表示するところで必ずこの関数を通す**。
 *
 * ## 方針：値は書き換えず、表示だけ整える
 * DB の文字列を一括変換して回るのは、元の入力（"応相談" など数値でないもの）を
 * 壊す危険がある。取り込み経路も複数あるので、また崩れる。
 * 表示側で正規化すれば、どの経路から入った値でも同じ見た目になる。
 *
 * ## 万円と円の見分け
 * SESの月額単価は 30〜120万 程度に収まる。桁で判断する:
 *   - 「万」と書いてある      → その数字が万
 *   - 10000 以上             → 円で入っている（400000 → 40万）
 *   - それ以外               → 万として入っている（40 → 40万）
 * 「1万円」のような書き方は月額単価としてあり得ないので考慮しない。
 */

/** 数字1つを万円の数値に読み替える */
function toMan(value: number, hasManUnit: boolean): number {
  if (hasManUnit) return value;
  // 10000以上は円で入っているとみなす（400000 → 40）
  if (value >= 10000) return Math.round(value / 10000);
  return value;
}

/** 小数の末尾0を落とす（40.0万 → 40万、67.5万 → 67.5万） */
function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

/**
 * 単価を「〇〇万」に整える。
 *
 * 数字が取れないものは**そのまま返す**（"応相談" "スキル見合い" などを消さない）。
 * 空・null は `fallback`（既定は "—"）。
 *
 * @example
 *   formatRate("¥40")      // "40万"
 *   formatRate("40")       // "40万"
 *   formatRate("40万")     // "40万"
 *   formatRate(400000)     // "40万"
 *   formatRate("60〜70万") // "60〜70万"
 *   formatRate("¥60~70")   // "60〜70万"
 *   formatRate("応相談")   // "応相談"
 *   formatRate(null)       // "—"
 */
export function formatRate(rate?: string | number | null, fallback = "—"): string {
  if (rate == null) return fallback;

  if (typeof rate === "number") {
    if (!Number.isFinite(rate) || rate <= 0) return fallback;
    return `${trim(toMan(rate, false))}万`;
  }

  const text = String(rate).trim();
  if (!text) return fallback;

  // カンマと円記号を落としてから数字を拾う
  const cleaned = text.replace(/[,，]/g, "").replace(/[¥￥]/g, "");
  const hasManUnit = /万/.test(cleaned);
  const numbers = cleaned.match(/\d+(?:\.\d+)?/g);

  // 数字が無いものは書き換えない（"応相談" "スキル見合い" など）
  if (!numbers || numbers.length === 0) return text;

  // 範囲（60〜70万 / 60-70 / 60~70）は範囲のまま出す
  const isRange =
    numbers.length >= 2 && /[〜~～\-–ー]/.test(cleaned.replace(/\d+(?:\.\d+)?/g, "|"));

  if (isRange) {
    const lo = toMan(parseFloat(numbers[0]), hasManUnit);
    const hi = toMan(parseFloat(numbers[1]), hasManUnit);
    if (!(lo > 0) || !(hi > 0)) return text;
    return lo === hi ? `${trim(lo)}万` : `${trim(lo)}〜${trim(hi)}万`;
  }

  const man = toMan(parseFloat(numbers[0]), hasManUnit);
  if (!(man > 0)) return text;
  return `${trim(man)}万`;
}

/**
 * 集計に使う万円の数値。取れなければ 0。
 * 見込み金額の合計など、足し算に使う側はこちらを通す。
 */
export function rateToMan(rate?: string | number | null): number {
  if (rate == null) return 0;
  if (typeof rate === "number") {
    return Number.isFinite(rate) && rate > 0 ? Math.round(toMan(rate, false)) : 0;
  }
  const cleaned = String(rate).replace(/[,，]/g, "").replace(/[¥￥]/g, "");
  const hasManUnit = /万/.test(cleaned);
  const m = cleaned.match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const man = toMan(parseFloat(m[0]), hasManUnit);
  return man > 0 ? Math.round(man) : 0;
}
