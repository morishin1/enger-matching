"use client";

// マッチング画面の期間セレクタ（統一デザイン・URL駆動）。
//   ?period=today|week|lastweek|month|all と、全期間チップのカレンダー(?from/?to)で
//   候補ランキング・おすすめTOP10・案件リストを登録日(created_at)で絞り込む。
//   既定は「全期間」。モードタブと同じ1段に置けるよう card=false（素の行）で描画する。
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodChips } from "./PeriodChips";
import { CLIENT_PERIOD_KEYS, CLIENT_PERIOD_LABEL, asClientPeriod } from "@/lib/period";

export function MatchingPeriodChips() {
  const router = useRouter();
  const sp = useSearchParams();
  const value = asClientPeriod(sp?.get("period"), "all");
  const from = sp?.get("from") ?? "";
  const to = sp?.get("to") ?? "";

  const go = (key: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    if (key === "all") u.delete("period"); else u.set("period", key);
    // 全期間以外を選んだらカレンダー指定はクリア。
    if (key !== "all") { u.delete("from"); u.delete("to"); }
    router.push(`/matching?${u.toString()}`);
  };
  const onRange = (f: string, t: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.delete("period"); // 全期間（カレンダー）扱い
    if (f) u.set("from", f); else u.delete("from");
    if (t) u.set("to", t); else u.delete("to");
    router.push(`/matching?${u.toString()}`);
  };

  const options = CLIENT_PERIOD_KEYS.map((k) => ({ key: k, label: CLIENT_PERIOD_LABEL[k] }));
  return (
    <PeriodChips
      value={value}
      onChange={go}
      options={options}
      calendar={{ calendarKey: "all", from, to, onRange }}
    />
  );
}
