"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { YearMonthPeriodBar } from "./YearMonthPeriodBar";
import { hasCustomRange, monthToRange, resolveMonthBarDisplay } from "@/lib/period";

// from/to のみで駆動する年+月バー（統一デザイン）。他のクエリパラメータ（tab等）は保持したまま
//   from/to だけを書き換える。エンド開拓・PRなど、既存に「プリセット期間」の概念が無かった画面で
//   共通に使う（マッチング/提案管理は period との併存があるため専用ラッパーを持つ）。
const two = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

export function SimpleRangeYearMonthBar({ basePath }: { basePath: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const from = sp?.get("from") ?? "";
  const to = sp?.get("to") ?? "";
  const custom = hasCustomRange(from, to);
  const now = new Date();
  const disp = resolveMonthBarDisplay(from, to, now.getFullYear());

  const push = (u: URLSearchParams) => router.push(`${basePath}?${u.toString()}`);
  const withBase = () => new URLSearchParams(sp?.toString() ?? "");
  const selectMonth = (y: number, m: number) => { const r = monthToRange(y, m); const u = withBase(); u.set("from", r.from); u.set("to", r.to); push(u); };
  const shiftYear = (delta: number) => selectMonth(disp.year + delta, disp.activeMonth ?? now.getMonth() + 1);
  const selectRange = (f: string, t: string) => { const u = withBase(); u.set("from", f); u.set("to", t); push(u); };
  const clearRange = () => { const u = withBase(); u.delete("from"); u.delete("to"); push(u); };

  const todayIso = iso(now);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // 月曜起点
  const weekStartIso = iso(weekStart);

  return (
    <YearMonthPeriodBar
      year={disp.year}
      activeMonth={disp.activeMonth}
      onSelectMonth={selectMonth}
      onShiftYear={shiftYear}
      calendarMode="range"
      range={disp.range}
      onSelectRange={selectRange}
      onClearRange={clearRange}
      shortcuts={[
        { key: "today", label: "今日", active: custom && from === todayIso && to === todayIso, onClick: () => selectRange(todayIso, todayIso) },
        { key: "week", label: "今週", active: custom && from === weekStartIso && to === todayIso, onClick: () => selectRange(weekStartIso, todayIso) },
        { key: "all", label: "全期間", active: !custom, onClick: clearRange },
      ]}
    />
  );
}
