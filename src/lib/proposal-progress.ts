// #334/#341：マッチングレコードの進捗状況の表示（リスト・カンバン共通）。
//   進捗状況（proposals.progress_status）＝ 未処理 / 案件側から返事待ち / 人材側から返事待ち / 両方から返事待ち。
//   日付は progress_updated_at（未設定なら記録日 created_at）。バッジ色は緊急度で出し分ける。

export type ProgressUrgency = "high" | "medium" | "low" | "ok";

export const PROGRESS_URGENCY_TONE: Record<ProgressUrgency, { fg: string; bg: string; bd: string }> = {
  high:   { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" },
  medium: { fg: "#b45309", bg: "#fff6e0", bd: "#fde9b0" },
  low:    { fg: "#0b5cab", bg: "#eaf4fd", bd: "#bfd9f5" },
  ok:     { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" },
};

function fmtYmd(d: any): string {
  if (!d) return "";
  const t = new Date(d);
  if (isNaN(t.getTime())) return "";
  return `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`;
}

export type ProgressDisplay = { status: string; text: string; urgency: ProgressUrgency; icon: string; tone: { fg: string; bg: string; bd: string } };

/** 進捗状況の表示情報（テキスト「状況（日付）」＋緊急度トーン＋アイコン）を返す。 */
export function progressDisplay(p: any): ProgressDisplay {
  const status = String(p?.progress_status || "未処理");
  const dateSrc = p?.progress_updated_at || p?.created_at;
  const d = fmtYmd(dateSrc);
  const text = d ? `${status}（${d}）` : status;
  const urgency: ProgressUrgency =
    status === "未処理" ? "high" : status === "両方から返事待ち" ? "medium" : "low";
  const icon =
    status === "未処理" ? "hourglass_empty"
    : status === "案件側から返事待ち" ? "business"
    : status === "人材側から返事待ち" ? "person"
    : "schedule";
  return { status, text, urgency, icon, tone: PROGRESS_URGENCY_TONE[urgency] };
}
