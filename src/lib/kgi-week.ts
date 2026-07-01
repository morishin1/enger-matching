// KGIダッシュボード：月を「実際の週（Mon-Fri・月内クリップ）」に分割し、
//   月次KPIを《営業日数 × 旬（月内リズム）ウェイト》で週へ配分する純粋計算。
//   ── 業界の月内リズム（仮説）──
//     上旬(1-10)  … 前月精算・当月入場フォロー（内向き）→ 提案は控えめ
//     中旬(11-20) … ★案件情報が出揃い提案を最大化（攻め・通常の約1.5倍）
//     下旬(21-末) … クロージング・契約更新確認（稼働=締めは下旬に厚い）
//   クライアントからも import できるよう副作用・サーバー依存なしの純関数のみ。
import type { KgiMonthly } from "./kgi-plan";

const two = (n: number) => String(n).padStart(2, "0");

export type Jun = "early" | "mid" | "late";
export function junOf(dom: number): Jun {
  return dom <= 10 ? "early" : dom <= 20 ? "mid" : "late";
}

// KPI段階ごとの旬ウェイト（月内のどこに山を置くかの仮説）。
export type SeasonProfile = { early: number; mid: number; late: number };
export const SEASON_PROFILES: Record<keyof KgiMonthly, SeasonProfile> = {
  appointment: { early: 0.8, mid: 1.5, late: 1.0 }, // 打ち合わせ：中旬に案件情報が出揃う
  proposal:    { early: 0.8, mid: 1.5, late: 1.0 }, // 提案：中旬に爆発
  meeting:     { early: 0.9, mid: 1.2, late: 1.1 }, // 面談：やや後ろ倒し
  placement:   { early: 0.8, mid: 1.0, late: 1.3 }, // 稼働（クロージング）：下旬に締め
};

export type KgiWeekMeta = {
  index: number;      // 1..n
  label: string;      // "7/1〜7/3"
  fromISO: string;    // 'YYYY-MM-DD'（週内・月内の最初の営業日）
  toISO: string;      // 'YYYY-MM-DD'（同・最後の営業日）
  bizDays: number;    // 週内の営業日数（月内クリップ）
  bizDates: number[]; // 各営業日の日（day-of-month）
  isCurrent: boolean; // 今日を含む週
  isPast: boolean;    // 週全体が過去
  remainingBiz: number; // 今日以降の残営業日（当月・当週用。過去=0・未来=bizDays）
};

/** 月（YYYY-MM-01）を Mon-Fri の週（月内クリップ）に分割。祝日は非考慮の簡易版。 */
export function weeksOfMonth(month: string, today: { y: number; m: number; d: number }): KgiWeekMeta[] {
  const [y, mo] = month.split("-").map((x) => Number(x)); // mo: 1-12
  if (!y || !mo) return [];
  const lastDay = new Date(y, mo, 0).getDate();
  const sameMonth = today.y === y && today.m === mo;
  const buckets: number[][] = [];
  let cur: number[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(y, mo - 1, d).getDay(); // 0=日 … 6=土
    if (dow === 1 && cur.length) { buckets.push(cur); cur = []; } // 月曜で週を区切る
    if (dow !== 0 && dow !== 6) cur.push(d);
  }
  if (cur.length) buckets.push(cur);

  return buckets.map((days, i) => {
    const first = days[0], last = days[days.length - 1];
    const isCurrent = sameMonth && today.d >= first && today.d <= last;
    const isPast = (today.y > y) || (today.y === y && today.m > mo) || (sameMonth && today.d > last);
    const isFuture = (today.y < y) || (today.y === y && today.m < mo) || (sameMonth && today.d < first);
    const remainingBiz = isPast ? 0 : isFuture ? days.length : days.filter((d) => d >= today.d).length;
    return {
      index: i + 1,
      label: `${mo}/${first}〜${mo}/${last}`,
      fromISO: `${y}-${two(mo)}-${two(first)}`,
      toISO: `${y}-${two(mo)}-${two(last)}`,
      bizDays: days.length,
      bizDates: days,
      isCurrent,
      isPast,
      remainingBiz,
    };
  });
}

/** 整数 total を weights 比で各要素へ配分（最大剰余法で Σ=total を保証）。 */
function allocate(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((x) => Math.floor(x));
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i]++;
  // 端数が残る（全fracが0など）場合は先頭から詰める。
  for (let k = 0; rem > 0; k = (k + 1) % n, rem--) out[k]++;
  return out;
}

/** 月次KPI件数を、旬ウェイト×営業日で各週へ配分（Σ=月次 を保証）。 */
export function distributeMonthlyToWeeks(monthly: number, weeks: KgiWeekMeta[], profile: SeasonProfile): number[] {
  const weights = weeks.map((w) => w.bizDates.reduce((s, d) => s + profile[junOf(d)], 0));
  return allocate(Math.max(0, Math.round(monthly)), weights);
}

// ── 年間シーズナリティ（月ごとの動向・仮説）──────────────────────────
//   日本の人材/SES市場のリズム（決算期・予算編成・夏枯れ/年末年始）を要約。
export type SeasonNote = { quarter: string; headline: string; note: string; push: boolean };
export const SEASON_NOTES: Record<number, SeasonNote> = {
  1:  { quarter: "4Q", headline: "年間最大の確変期（本決算に向け）", note: "正月明け2週目から提案を限界まで。既存現場への3-4月増員提案が最も通りやすい。", push: true },
  2:  { quarter: "4Q", headline: "案件数・流動性が年間最大級", note: "予算消化の短期発注＋4月要員確保が同時発生。エンド開拓の仕込みにも好機。", push: true },
  3:  { quarter: "4Q", headline: "本決算の山（売上の山・大）", note: "予算消化と4月新PJ要員確保。ここで動けないと年間目標の達成は厳しい。", push: true },
  4:  { quarter: "1Q", headline: "新体制の把握と種まき", note: "提案数より、エンド/上位商流の新組織図・決済ルートの情報収集に徹する。", push: false },
  5:  { quarter: "1Q", headline: "GWで稼働日減・スローダウン", note: "営業は一時停滞。注力PJ・要員計画のヒアリングを進める。", push: false },
  6:  { quarter: "1Q", headline: "種まき継続（7月の提案増へ）", note: "2Qの提案増に備え、候補者を仕込み面談を設定しておく。", push: false },
  7:  { quarter: "2Q", headline: "10月稼働へ提案数UP（売上の山・小）", note: "中旬〜下旬に提案を爆発的に。8月の夏枯れを見越し7月中に候補者を仕込む。", push: true },
  8:  { quarter: "2Q", headline: "前半〜お盆は夏枯れ", note: "連絡がつきにくい停滞期。後半から9月急増の入口。仕込みを切らさない。", push: false },
  9:  { quarter: "2Q", headline: "中間決算で案件急増", note: "下期スタート(10月)に向け8月後半〜9月に案件急増。売上の山（小）。", push: true },
  10: { quarter: "3Q", headline: "エンド開拓の黄金期①", note: "下期スタートで案件安定。翌年度予算編成前にエンド直開拓を仕掛ける。", push: false },
  11: { quarter: "3Q", headline: "エンド開拓の黄金期②", note: "来期予算確定前が最好機。DX/内製化課題をヒアリングし4月大型案件に食い込む。", push: false },
  12: { quarter: "3Q", headline: "後半は年末年始で市場停止", note: "エンド企業は翌4月予算を編成中。前半に来期の種まきを済ませる。", push: false },
};
