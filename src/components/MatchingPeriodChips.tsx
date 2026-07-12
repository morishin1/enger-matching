"use client";

// マッチング画面の期間セレクタ（統一デザイン：年+月ピル＋カレンダー範囲選択）。
//   URL連動は従来どおり ?period=today|week|lastweek|all と ?from=&to=（カレンダー/月ピル）。
//   月ピルを押すと、その月の月初〜月末を from/to にセットする（period は解除）。
//   これにより matching/page.tsx 側のフィルタ計算（mPeriod/mCustom・inClientPeriod/inCustomRange）
//   は一切変更不要（from/to があれば custom 扱いという既存ロジックをそのまま使い回す）。
//   コンポーネント名・呼び出し方（<MatchingPeriodChips />）は既存のまま維持し、見た目のみ刷新する。
import { useRouter, useSearchParams } from "next/navigation";
import { YearMonthPeriodBar } from "./YearMonthPeriodBar";
import { hasCustomRange, monthToRange, resolveMonthBarDisplay } from "@/lib/period";

export function MatchingPeriodChips() {
  const router = useRouter();
  const sp = useSearchParams();
  const period = sp?.get("period") ?? "";
  const from = sp?.get("from") ?? "";
  const to = sp?.get("to") ?? "";
  const custom = hasCustomRange(from, to);

  const now = new Date();
  const disp = resolveMonthBarDisplay(from, to, now.getFullYear());
  let { year, activeMonth } = disp;
  // 旧プリセット「今月」からの遷移互換（新UIはこの値をもう生成しないが古いリンク救済）。
  if (!custom && period === "month") activeMonth = now.getMonth() + 1;
  // 初回アクセス（period も from/to も無い）は「当月」を既定選択にする（要望：全期間ではなく当月）。
  //   これに合わせて matching/page.tsx も同条件で当月レンジを既定フィルタにしている。
  //   「全期間」は明示選択（?period=all）時のみハイライトする。
  const bareVisit = !period && !custom;
  if (bareVisit) { year = now.getFullYear(); activeMonth = now.getMonth() + 1; }

  const push = (params: URLSearchParams) => router.push(`/matching?${params.toString()}`);
  const withBase = () => new URLSearchParams(sp?.toString() ?? "");

  const selectMonth = (y: number, m: number) => {
    const u = withBase();
    const r = monthToRange(y, m);
    u.delete("period"); u.set("from", r.from); u.set("to", r.to);
    push(u);
  };
  const shiftYear = (delta: number) => selectMonth(year + delta, activeMonth ?? now.getMonth() + 1);
  const selectRange = (f: string, t: string) => {
    const u = withBase();
    u.delete("period"); u.set("from", f); u.set("to", t);
    push(u);
  };
  const clearRange = () => {
    const u = withBase();
    u.delete("period"); u.delete("from"); u.delete("to");
    push(u);
  };
  const setPreset = (key: string) => {
    const u = withBase();
    u.set("period", key); u.delete("from"); u.delete("to");
    push(u);
  };

  // 「全期間」は明示選択（?period=all）のときだけアクティブ。初回（bareVisit）は当月選択なので非アクティブ。
  const isAll = !custom && period === "all";
  return (
    <YearMonthPeriodBar
      year={year}
      activeMonth={activeMonth}
      onSelectMonth={selectMonth}
      onShiftYear={shiftYear}
      calendarMode="range"
      range={custom && !activeMonth ? { from, to } : null}
      onSelectRange={selectRange}
      onClearRange={clearRange}
      shortcuts={[
        { key: "today", label: "今日", active: !custom && period === "today", onClick: () => setPreset("today") },
        // #345②：今日と今週の間に「3日以内」を追加。
        { key: "3days", label: "3日以内", active: !custom && period === "3days", onClick: () => setPreset("3days") },
        { key: "week", label: "今週", active: !custom && period === "week", onClick: () => setPreset("week") },
        { key: "all", label: "全期間", active: isAll, onClick: () => setPreset("all") },
      ]}
    />
  );
}
