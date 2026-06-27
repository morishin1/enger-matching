// 期間セレクタ（統一デザイン）共通の期間キー・ラベル・範囲計算。
//   サーバー/クライアント双方から使うため "use client" は付けない（純関数のみ）。
//   提案ボード/失注/承認/マッチングで同じ意味（created_at の日付レンジ）に揃える。

export type ClientPeriod = "today" | "week" | "lastweek" | "month" | "thirty" | "all";

export const CLIENT_PERIOD_LABEL: Record<ClientPeriod, string> = {
  today: "本日", week: "今週", lastweek: "先週", month: "今月", thirty: "30日", all: "全期間",
};
export const CLIENT_PERIOD_KEYS: ClientPeriod[] = ["today", "week", "lastweek", "month", "thirty", "all"];

export function asClientPeriod(v: string | null | undefined, fallback: ClientPeriod = "all"): ClientPeriod {
  return (CLIENT_PERIOD_KEYS as string[]).includes(v ?? "") ? (v as ClientPeriod) : fallback;
}

// 今週（月曜起点）の開始時刻。
function thisWeekStart(): number {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 月曜起点
  d.setDate(d.getDate() - dow);
  return d.getTime();
}
export function periodStartMs(p: ClientPeriod): number {
  const now = new Date();
  if (p === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (p === "week") return thisWeekStart();
  if (p === "lastweek") return thisWeekStart() - 7 * 86400000;
  if (p === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (p === "thirty") return Date.now() - 30 * 86400000;
  return 0; // all
}
export function periodEndMs(p: ClientPeriod): number {
  if (p === "lastweek") return thisWeekStart();
  return Number.POSITIVE_INFINITY;
}
export function inClientPeriod(createdAt: string | number | null | undefined, p: ClientPeriod): boolean {
  if (p === "all") return true;
  const t = typeof createdAt === "number" ? createdAt : new Date(createdAt ?? 0).getTime();
  return !!t && t >= periodStartMs(p) && t < periodEndMs(p);
}
