"use client";

// ★評価の入力/表示（Material Symbols の star を使用）。
//   StarsInput : クリックで 1〜5 を選択（同じ星をもう一度押すと 0=未評価）
//   StarsView  : 読み取り専用表示（任意で数値・件数を併記）
const GOLD = "#f5a623";
const EMPTY = "var(--color-ink-5)";

export function StarsInput({ value, onChange, size = 20 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)} aria-label={`★${n}`}
          style={{ background: "none", border: 0, cursor: "pointer", padding: 0, lineHeight: 0 }}>
          <span className="material-symbols-outlined"
            style={{ fontSize: size, color: n <= value ? GOLD : EMPTY, fontVariationSettings: n <= value ? "'FILL' 1" : "'FILL' 0" }}>star</span>
        </button>
      ))}
    </span>
  );
}

export function StarsView({ value, size = 14, showNumber = false, count }: { value: number | null | undefined; size?: number; showNumber?: boolean; count?: number }) {
  if (!value || value <= 0) return <span className="muted" style={{ fontSize: 12 }}>—</span>;
  const v = Math.round(value);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className="material-symbols-outlined"
          style={{ fontSize: size, color: n <= v ? GOLD : EMPTY, fontVariationSettings: n <= v ? "'FILL' 1" : "'FILL' 0" }}>star</span>
      ))}
      {showNumber && <span style={{ fontSize: 11, color: "var(--color-ink-3)", marginLeft: 4 }}>{value.toFixed(1)}{count != null ? `（${count}）` : ""}</span>}
    </span>
  );
}
