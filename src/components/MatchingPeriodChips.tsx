"use client";

// マッチング画面の期間セレクタ（統一デザイン）。
//   URL ?period=today|week|lastweek|month|thirty|all を切り替え、サーバー側で
//   候補ランキング・おすすめTOP10・案件リストを登録日(created_at)で絞り込む。
//   既定は「全期間」（=従来どおり鮮度ウィンドウのみ。期間で更に絞りたいとき選ぶ）。
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodChips } from "./PeriodChips";
import { CLIENT_PERIOD_KEYS, CLIENT_PERIOD_LABEL, asClientPeriod } from "@/lib/period";

export function MatchingPeriodChips({ counts }: { counts?: Partial<Record<string, number>> }) {
  const router = useRouter();
  const sp = useSearchParams();
  const value = asClientPeriod(sp?.get("period"), "all");

  const go = (key: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    if (key === "all") u.delete("period"); else u.set("period", key);
    router.push(`/matching?${u.toString()}`);
  };

  const options = CLIENT_PERIOD_KEYS.map((k) => ({ key: k, label: CLIENT_PERIOD_LABEL[k], count: counts?.[k] ?? null }));
  return (
    <PeriodChips card value={value} onChange={go} options={options}
      note="案件・人材の登録日でマッチング対象を絞り込みます" />
  );
}
