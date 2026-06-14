// 受信者（案件先・人材先）の応答ステータス表示（job_action_type / cand_action_type 列）。
//   ・話を進める … 緑で点灯
//   ・見送り     … 赤で点灯
//   ・未回答     … グレーの破線（反応なし）
//   リスト表示・カンバン表示の両方で同じ見た目を使うため、ここに集約する。

// 受信者の応答タイプ（PR #130 で導入された job_action_type / cand_action_type 列）。
export const ACTION_TONE: Record<string, { fg: string; bg: string; dashed: boolean }> = {
  "未回答":    { fg: "#94a3b8", bg: "transparent", dashed: true },
  "話を進める": { fg: "#16a34a", bg: "#dcfce7",    dashed: false },
  "見送り":    { fg: "#dc2626", bg: "#fee2e2",    dashed: false },
};
const ACTION_SIDE_LABEL: Record<"job" | "cand", string> = { job: "案", cand: "人" };

export function ActionChip({ type, side, compact = false }: { type?: string | null; side: "job" | "cand"; compact?: boolean }) {
  const t = type && ACTION_TONE[type] ? type : "未回答";
  const tone = ACTION_TONE[t];
  return (
    <span
      title={`${side === "job" ? "案件先" : "人材先"}の応答：${t}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: compact ? 9.5 : 10.5, fontWeight: 700, padding: compact ? "1px 5px" : "2px 7px", borderRadius: 99,
        background: tone.bg, color: tone.fg,
        border: `1px ${tone.dashed ? "dashed" : "solid"} ${tone.fg}55`,
      }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: t === "未回答" ? "transparent" : tone.fg, border: t === "未回答" ? "1px dashed #94a3b8" : "none" }} />
      <span>{ACTION_SIDE_LABEL[side]}</span>
      {!compact && <span style={{ fontSize: 9.5, opacity: 0.9 }}>{t}</span>}
    </span>
  );
}

/** 案件先・人材先の応答チップを並べて表示する。 */
export function ActionChips({ jobType, candType, compact = false }: { jobType?: string | null; candType?: string | null; compact?: boolean }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <ActionChip type={jobType} side="job" compact={compact} />
      <ActionChip type={candType} side="cand" compact={compact} />
    </span>
  );
}
