// 企業の「承認済み（打合せ済）／未承認」を示すバッジ。サーバ/クライアント両用（純粋表示）。
export function CompanyApprovalBadge({ approved, size = "sm" }: { approved: boolean; size?: "sm" | "xs" }) {
  const xs = size === "xs";
  const base = {
    display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", flexShrink: 0,
    fontSize: xs ? 10 : 11, fontWeight: 700,
    padding: xs ? "1px 6px" : "2px 8px", borderRadius: 99,
  } as const;
  return approved ? (
    <span title="打ち合わせ完了（承認）済みの企業" style={{ ...base, background: "#e7f7ee", color: "#067647", border: "1px solid #bfe3cc" }}>
      ✓ 承認済み
    </span>
  ) : (
    <span title="まだ打ち合わせ（承認）が済んでいない企業" style={{ ...base, background: "#fdecef", color: "#b42318", border: "1px solid #f7c5cf" }}>
      未承認
    </span>
  );
}
