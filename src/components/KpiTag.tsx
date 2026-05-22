// KPI カードの状態タグ（最重要 / 要対応 / 要改善 / 要確認 / フロー）
const MAP: Record<string, { label: string; bg: string; fg: string }> = {
  pri: { label: "最重要", bg: "#fde9ef", fg: "#c0395f" },
  todo: { label: "要対応", bg: "#fdeede", fg: "#b5651d" },
  fix: { label: "要改善", bg: "#fef6e0", fg: "#9a7b12" },
  check: { label: "要確認", bg: "#e7f0fb", fg: "#2864ad" },
  flow: { label: "フロー", bg: "#eef0f3", fg: "#5a6573" },
};

export function KpiTag({ kind, label }: { kind: keyof typeof MAP | string; label?: string }) {
  const c = MAP[kind] ?? MAP.flow;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99,
      background: c.bg, color: c.fg, whiteSpace: "nowrap",
    }}>
      {label ?? c.label}
    </span>
  );
}
