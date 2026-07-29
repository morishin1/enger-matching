// 「受託開発・エンド」バッジ（管理NO #491）。
//   SES の商流を挟まない受託開発／エンドユーザー企業であることを示す。
//   企業管理の一覧・企業詳細・案件一覧のクライアント名の横に出す。
//   サーバ/クライアント両用（"use client" を付けない純粋表示コンポーネント）。
export function EndClientBadge({ size = "sm", compact = false }: { size?: "sm" | "xs"; compact?: boolean }) {
  const xs = size === "xs";
  return (
    <span
      title="受託開発・エンド企業（商流を挟まない直取引先）"
      style={{
        display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap",
        fontSize: xs ? 9.5 : 11, fontWeight: 700, lineHeight: 1.4,
        padding: xs ? "1px 6px" : "2px 8px", borderRadius: 99,
        background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe",
        flexShrink: 0,
      }}
    >
      {/* compact は企業一覧のように企業名の右で幅が取れない場所用。
          アイコンだけにするとフォント未読込時に "apartment" と出て意味が通らないため、
          短いテキスト「エンド」にしている（同じ色・同じ形なので同一のマークだと分かる）。 */}
      {compact ? (
        "エンド"
      ) : (
        <>
          <span className="material-symbols-outlined" style={{ fontSize: xs ? 12 : 13 }}>apartment</span>
          受託開発・エンド
        </>
      )}
    </span>
  );
}
