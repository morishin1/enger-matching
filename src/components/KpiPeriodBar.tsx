"use client";

// 提案管理「KPI推移」タブ上部の期間切り替えバー。
//   他メニューと同じ統一デザインの6チップ（本日/今週/先週/今月/30日/全期間）に揃える。
//   各チップを、KPIダッシュボードのサーバー集計（?period/?from/?to）にマッピングして再取得し、
//   その期間の KPI・KGI（提案/接触/調整/日程/成約）の達成率を表示する。
//   ・本日→day / 今週→week / 今月→month（サーバー既定の粒度）
//   ・先週/30日/全期間→ custom（from/to を指定）。全期間チップはカレンダーで任意期間も指定可。
//   表示中チップの判定用に ?kp=<chipKey> も併せて持つ（サーバーは無視）。
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodChips } from "./PeriodChips";
import { CLIENT_PERIOD_KEYS, CLIENT_PERIOD_LABEL, type ClientPeriod } from "@/lib/period";

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mondayThisWeek(): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// 6チップ → サーバー集計（period/from/to）への変換。
function rangeFor(key: ClientPeriod): { period: string; from?: string; to?: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (key === "today") return { period: "day" };
  if (key === "week") return { period: "week" };
  if (key === "month") return { period: "month" };
  if (key === "lastweek") {
    const lm = mondayThisWeek(); lm.setDate(lm.getDate() - 7);
    const ls = mondayThisWeek(); ls.setDate(ls.getDate() - 1);
    return { period: "custom", from: ymd(lm), to: ymd(ls) };
  }
  if (key === "thirty") {
    const f = new Date(today); f.setDate(f.getDate() - 29);
    return { period: "custom", from: ymd(f), to: ymd(today) };
  }
  return { period: "custom", from: "2000-01-01", to: ymd(today) }; // all
}

function mapServerToChip(p?: string | null): ClientPeriod {
  if (p === "week") return "week";
  if (p === "month") return "month";
  if (p === "day" || p === "yesterday") return "today";
  return "all"; // custom 等はカレンダー（全期間）扱い
}

export function KpiPeriodBar({ current }: { current?: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const kp = sp?.get("kp") ?? "";
  const active: ClientPeriod = (CLIENT_PERIOD_KEYS as string[]).includes(kp)
    ? (kp as ClientPeriod)
    : mapServerToChip(current || sp?.get("period"));
  // 全期間の番兵レンジ（2000-01-01〜本日）はカレンダー表示では空欄にする（「未指定＝全期間」を表現）。
  const rawFrom = sp?.get("from") ?? "";
  const rawTo = sp?.get("to") ?? "";
  const isAllSentinel = rawFrom === "2000-01-01";
  const from = isAllSentinel ? "" : rawFrom;
  const to = isAllSentinel ? "" : rawTo;

  const push = (period: string, f?: string, t?: string, chip?: string) => {
    const u = new URLSearchParams(sp?.toString() ?? "");
    u.set("period", period);
    if (f) u.set("from", f); else u.delete("from");
    if (t) u.set("to", t); else u.delete("to");
    if (chip) u.set("kp", chip); else u.delete("kp");
    router.push(`/proposals?${u.toString()}`);
  };
  const go = (key: string) => { const r = rangeFor(key as ClientPeriod); push(r.period, r.from, r.to, key); };
  const onRange = (f: string, t: string) => {
    // 全期間チップのカレンダーで任意期間を指定（空なら全期間に戻す）。
    if (!f && !t) { const r = rangeFor("all"); push(r.period, r.from, r.to, "all"); return; }
    push("custom", f || undefined, t || undefined, "all");
  };

  const options = CLIENT_PERIOD_KEYS.map((k) => ({ key: k, label: CLIENT_PERIOD_LABEL[k] }));
  return (
    <PeriodChips
      card
      value={active}
      onChange={go}
      options={options}
      calendar={{ calendarKey: "all", from, to, onRange }}
      note="選択した期間の KPI・KGI 達成率を表示します"
    />
  );
}
