"use client";

// 一覧ページ（案件・人材など）用の期間セレクタ（統一デザイン・URL駆動）。
//   ?period=today|week|lastweek|month|all を切り替え、サーバー側で
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
  const from = sp?.get("from") ?? "";
  const to = sp?.get("to") ?? "";

  const go = (key: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    if (key === "all") u.delete("period"); else u.set("period", key);
    if (key !== "all") { u.delete("from"); u.delete("to"); } // 全期間以外はカレンダー指定をクリア
    u.delete("page"); // 期間を変えたら1ページ目へ
    const qs = u.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  };
  const onRange = (f: string, t: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.delete("period");
    if (f) u.set("from", f); else u.delete("from");
    if (t) u.set("to", t); else u.delete("to");
    u.delete("page");
    const qs = u.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ""}`);
  };

  // #345②：「3日以内」はマッチング画面専用のチップ（MatchingPeriodChips 側で表示）。
  //   共通の期間バーには出さない（他画面は従来の見た目を維持）。
  const options = CLIENT_PERIOD_KEYS.filter((k) => k !== "3days").map((k) => ({ key: k, label: CLIENT_PERIOD_LABEL[k], count: counts?.[k] ?? null }));
  return <PeriodChips card={card} value={value} onChange={go} options={options} note={note}
    calendar={{ calendarKey: "all", from, to, onRange }} />;
}
