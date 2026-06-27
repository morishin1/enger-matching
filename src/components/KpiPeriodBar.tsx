"use client";

// 提案管理「KPI推移」タブ上部の期間切り替えバー。
//   メンバー別アクティビティ／ステージ目標・KPI/KGI達成率の表に期間切替を効かせる。
//   URL の ?period を切り替えて再取得する（サーバ側 loadKpiClientProps が期間で集計）。
//   既定は「本日」。前日/今週/今月/四半期/任意（カレンダー）に切替可能。
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodChips } from "./PeriodChips";

// KPI推移は「推移グラフ」のため期間＝集計の粒度（本日=日次/今週=週次/今月=月次/四半期）。
//   提案ボード等の“日付レンジ絞り込み”とは意味が違うので、ここは専用キーを保つ。
//   見た目だけ共通の PeriodChips（統一デザイン）に揃える。
const PERIODS = [
  { key: "day", label: "本日" },
  { key: "yesterday", label: "前日" },
  { key: "week", label: "今週" },
  { key: "month", label: "今月" },
  { key: "quarter", label: "四半期" },
  { key: "custom", label: "任意" },
];

export function KpiPeriodBar({ current }: { current?: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  // 既定（未指定）は本日(day)扱い。
  const active = current || sp?.get("period") || "day";

  const go = (key: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.set("period", key);
    if (key !== "custom") { u.delete("from"); u.delete("to"); } // 任意以外は日付指定をクリア
    router.push(`/proposals?${u.toString()}`);
  };

  return (
    <PeriodChips
      card
      value={active}
      onChange={go}
      options={PERIODS}
      note={active === "custom" ? "※「任意」は下のKPIダッシュボードの日付欄で範囲を指定してください。" : undefined}
    />
  );
}
