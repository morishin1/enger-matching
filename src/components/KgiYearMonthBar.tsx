"use client";

import { useRouter } from "next/navigation";
import { YearMonthPeriodBar } from "./YearMonthPeriodBar";

// KGI/KPIダッシュボードの年+月バー（統一デザイン）。
//   KGIは月次集計（売上目標・人員配分・KPI逆算）のみを扱うため、任意の日付レンジ集計は
//   サポートしない。カレンダーアイコンは「1日クリックでその月にジャンプ」の単発モード
//   （calendarMode="single"）とし、?y=&m= の既存クエリ契約は変えずに済ませる。
export function KgiYearMonthBar({ year, month }: { year: number; month: number }) {
  const router = useRouter();
  const go = (y: number, m: number) => router.push(`/kgi?y=${y}&m=${m}`);
  const pickDate = (dateStr: string) => {
    const [y, m] = dateStr.split("-").map(Number);
    go(y, m);
  };
  return (
    <YearMonthPeriodBar
      year={year}
      activeMonth={month}
      onSelectMonth={go}
      onShiftYear={(delta) => go(year + delta, month)}
      calendarMode="single"
      onPickDate={pickDate}
    />
  );
}
