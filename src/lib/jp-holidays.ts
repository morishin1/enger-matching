// 日本の祝日判定（純粋計算・クライアントからも import 可）。#259 面談日程カレンダーの土日祝ブロック用。
//   国民の祝日に関する法律に基づくアルゴリズム実装（1980〜2099年で有効）：
//   固定日＋ハッピーマンデー＋春分/秋分（近似式）＋振替休日＋国民の休日。
//   ※ 法改正（祝日の新設・移動）があった場合はここを更新する。

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// その年の第n月曜の日付（day of month）。
function nthMonday(y: number, m: number, n: number): number {
  const first = new Date(y, m - 1, 1).getDay(); // 0=日…6=土
  const offset = (8 - first) % 7; // 最初の月曜まで
  return 1 + offset + (n - 1) * 7;
}
// 春分/秋分の日（近似式・1980〜2099年）。
const shunbun = (y: number) => Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
const shubun = (y: number) => Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

// その年の祝日集合（"YYYY-MM-DD"）。振替休日・国民の休日も含む。
const cache = new Map<number, Set<string>>();
function holidaysOfYear(y: number): Set<string> {
  const hit = cache.get(y);
  if (hit) return hit;
  const base: [number, number][] = [
    [1, 1],                    // 元日
    [1, nthMonday(y, 1, 2)],   // 成人の日
    [2, 11],                   // 建国記念の日
    [2, 23],                   // 天皇誕生日
    [3, shunbun(y)],           // 春分の日
    [4, 29],                   // 昭和の日
    [5, 3], [5, 4], [5, 5],    // 憲法記念日・みどりの日・こどもの日
    [7, nthMonday(y, 7, 3)],   // 海の日
    [8, 11],                   // 山の日
    [9, nthMonday(y, 9, 3)],   // 敬老の日
    [9, shubun(y)],            // 秋分の日
    [10, nthMonday(y, 10, 2)], // スポーツの日
    [11, 3],                   // 文化の日
    [11, 23],                  // 勤労感謝の日
  ];
  const set = new Set(base.map(([m, d]) => key(y, m, d)));
  // 振替休日：祝日が日曜 → 直後の「祝日でない」平日（実質、月曜以降の最初の非祝日）。
  for (const [m, d] of base) {
    const dt = new Date(y, m - 1, d);
    if (dt.getDay() !== 0) continue;
    const sub = new Date(dt);
    do { sub.setDate(sub.getDate() + 1); } while (set.has(key(sub.getFullYear(), sub.getMonth() + 1, sub.getDate())));
    set.add(key(sub.getFullYear(), sub.getMonth() + 1, sub.getDate()));
  }
  // 国民の休日：前日と翌日が祝日に挟まれた平日（例：シルバーウィークの敬老の日と秋分の間）。
  for (const [m, d] of base) {
    const mid = new Date(y, m - 1, d + 2); // 祝日+2日 が祝日なら +1日 が候補
    if (!set.has(key(mid.getFullYear(), mid.getMonth() + 1, mid.getDate()))) continue;
    const between = new Date(y, m - 1, d + 1);
    const bk = key(between.getFullYear(), between.getMonth() + 1, between.getDate());
    if (!set.has(bk) && between.getDay() !== 0) set.add(bk);
  }
  cache.set(y, set);
  return set;
}

/** "YYYY-MM-DD" が日本の祝日か。 */
export function isJpHoliday(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!m) return false;
  return holidaysOfYear(Number(m[1])).has(dateStr);
}

/** "YYYY-MM-DD" が土日または祝日か（面談日程の選択不可判定）。 */
export function isWeekendOrJpHoliday(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!m) return false;
  const dow = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  if (dow === 0 || dow === 6) return true;
  return isJpHoliday(dateStr);
}