// 「クローズ済」バッジ。案件/人材が is_closed のときに番号の隣などに表示する。
//   サーバ/クライアント両用（"use client" を付けない純粋表示コンポーネント）。
export function ClosedBadge({ size = "sm" }: { size?: "sm" | "xs" }) {
  const xs = size === "xs";
  return (
    <span
      title="この案件・人材はクローズ済です（一覧には表示されません）"
      style={{
        display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
        fontSize: xs ? 10 : 11, fontWeight: 700,
        padding: xs ? "1px 6px" : "2px 8px", borderRadius: 99,
        background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf",
      }}
    >
      クローズ済
    </span>
  );
}
