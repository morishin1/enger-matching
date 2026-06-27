"use client";

// 一覧ページ（案件・人材など）用の期間セレクタ（統一デザイン・URL駆動）。
//   ?period=today|week|lastweek|month|thirty|all を切り替え、サーバー側で
//   登録日(created_at)により一覧を絞り込む。各チップに件数を表示できる。
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodChips } from "./PeriodChips";
import { CLIENT_PERIOD_KEYS, CLIENT_PERIOD_LABEL, asClientPeriod, type ClientPeriod } from "@/lib/period";

export function UrlPeriodChips({ basePath, counts, note, card = false }: {
  basePath: string;
  counts?: Partial<Record<ClientPeriod, number | null>>;
  note?: string;
  card?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const value = asClientPeriod(sp?.get("period"), "all");

  const go = (key: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    if (key === "all") u.delete("period"); else u.set("period", key);
    u.delete("page"); // 期間を変えたら1ページ目へ
    const qs = u.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  };

  const options = CLIENT_PERIOD_KEYS.map((k) => ({ key: k, label: CLIENT_PERIOD_LABEL[k], count: counts?.[k] ?? null }));
  return <PeriodChips card={card} value={value} onChange={go} options={options} note={note} />;
}
