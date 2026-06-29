"use client";

// 提案管理「KPI推移」タブ上部の期間切り替えバー。
//   チップ：本日 / 昨日 / 今週 / 先週 / 今月 / 3ヶ月 / 期間指定（カレンダー）。
//   各チップを KPIダッシュボードのサーバー集計（?period/?from/?to）にマッピングして再取得し、
//   その期間の KPI・KGI（提案/接触/調整/日程/成約）達成率・各表/グラフを集計し直す。
//     本日→day / 昨日→yesterday / 今週→week / 今月→month / 3ヶ月→quarter
//     先週→custom(先週の月〜日) / 期間指定→custom(カレンダーで任意)
//   表示中チップの判定用に ?kp=<chipKey> も併せて持つ。
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodChips } from "./PeriodChips";

type KpiChip = "today" | "yesterday" | "week" | "lastweek" | "month" | "quarter" | "custom";
const KPI_CHIPS: { key: KpiChip; label: string }[] = [
  { key: "today", label: "本日" },
  { key: "yesterday", label: "昨日" },
  { key: "week", label: "今週" },
  { key: "lastweek", label: "先週" },
  { key: "month", label: "今月" },
  { key: "quarter", label: "3ヶ月" },
  { key: "custom", label: "期間指定" },
];
const KPI_CHIP_KEYS = KPI_CHIPS.map((c) => c.key);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayThisWeek(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// チップ → サーバー集計（period/from/to）。
function rangeFor(key: KpiChip): { period: string; from?: string; to?: string } {
  if (key === "today") return { period: "day" };
  if (key === "yesterday") return { period: "yesterday" };
  if (key === "week") return { period: "week" };
  if (key === "month") return { period: "month" };
  if (key === "quarter") return { period: "quarter" };
  if (key === "lastweek") {
    const ws = mondayThisWeek(); const lm = new Date(ws); lm.setDate(lm.getDate() - 7);
    const ls = new Date(ws); ls.setDate(ls.getDate() - 1);
    return { period: "custom", from: ymd(lm), to: ymd(ls) };
  }
  return { period: "custom" }; // 期間指定（カレンダーで from/to を後から指定）
}

// 初期表示（?kp 未指定）時、サーバーの period から表示チップを推定。
function mapServerToChip(p?: string | null): KpiChip {
  if (p === "yesterday") return "yesterday";
  if (p === "week") return "week";
  if (p === "month") return "month";
  if (p === "quarter") return "quarter";
  if (p === "day") return "today";
  if (p === "custom") return "custom";
  return "today";
}

export function KpiPeriodBar({ current, basePath = "/proposals", card = true, note = "選択した期間の KPI・KGI を各表・グラフで集計します" }: { current?: string | null; basePath?: string; card?: boolean; note?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const kp = sp?.get("kp") ?? "";
  const active: KpiChip = (KPI_CHIP_KEYS as string[]).includes(kp) ? (kp as KpiChip) : mapServerToChip(current || sp?.get("period"));

  // カレンダー（期間指定）チップ選択中のみ from/to を表示する（先週等の内部 from/to は出さない）。
  const showCal = active === "custom";
  const from = showCal ? (sp?.get("from") ?? "") : "";
  const to = showCal ? (sp?.get("to") ?? "") : "";

  const push = (period: string, f?: string, t?: string, chip?: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.set("period", period);
    if (f) u.set("from", f); else u.delete("from");
    if (t) u.set("to", t); else u.delete("to");
    if (chip) u.set("kp", chip); else u.delete("kp");
    router.push(`${basePath}?${u.toString()}`);
  };
  const go = (key: string) => { const r = rangeFor(key as KpiChip); push(r.period, r.from, r.to, key); };
  const onRange = (f: string, t: string) => push("custom", f || undefined, t || undefined, "custom");

  return (
    <PeriodChips
      card={card}
      value={active}
      onChange={go}
      options={KPI_CHIPS}
      calendar={{ calendarKey: "custom", from, to, onRange }}
      note={note}
    />
  );
}
