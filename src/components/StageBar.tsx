"use client";

// 応募ステージの進捗バー。応募 → 書類選考 → 面談 → 面談合格 → 稼働 を横並びで可視化。
// 各ステージをクリックでその状態に遷移（順序強制なし。後戻りも許可）。
// 「見送り」は別枠の赤ボタンで誤クリックを防ぐ。

import { useTransition } from "react";

const FLOW = ["応募", "書類選考", "面談", "面談合格", "稼働"] as const;
type Stage = (typeof FLOW)[number] | "見送り";

const TONE: Record<Stage, { fg: string; bg: string; bd: string }> = {
  応募:     { fg: "#475467", bg: "#eef2f5", bd: "#cbd2da" },
  書類選考: { fg: "#0b5cab", bg: "#eaf4fd", bd: "#bcdcf8" },
  面談:     { fg: "#9a7b12", bg: "#fff6e0", bd: "#fde9b0" },
  面談合格: { fg: "#067647", bg: "#e7f7ee", bd: "#bfe3cc" },
  稼働:     { fg: "#fff",    bg: "#067647", bd: "#067647" },
  見送り:   { fg: "#b42318", bg: "#fdecef", bd: "#f7c5cf" },
};

export function StageBar({ current, onChange, disabled }: {
  current: string;
  onChange: (next: Stage) => void;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const cur = (FLOW as readonly string[]).includes(current) ? (current as Stage) : (current === "見送り" ? "見送り" : "応募");
  const currentIdx = FLOW.indexOf(cur as any);
  const isReject = cur === "見送り";

  const set = (s: Stage) => { if (s === cur) return; start(() => onChange(s)); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "wrap" }}>
        {FLOW.map((s, i) => {
          const done = !isReject && i < currentIdx;
          const active = !isReject && i === currentIdx;
          const next = !isReject && i === currentIdx + 1;
          const t = TONE[s];
          return (
            <button
              type="button"
              key={s}
              onClick={() => set(s)}
              disabled={disabled || pending}
              title={active ? `現在: ${s}` : (next ? `次の推奨: ${s}` : `${s} に変更`)}
              style={{
                position: "relative",
                padding: "5px 12px",
                marginRight: i < FLOW.length - 1 ? 4 : 0,
                border: `1px solid ${active || done ? t.bd : "var(--color-border)"}`,
                background: active ? t.bg : done ? "#f6f8fa" : "var(--color-surface)",
                color: active ? t.fg : done ? "#9aa7b4" : "var(--color-ink-3)",
                borderRadius: 99,
                fontSize: 11.5,
                fontWeight: active ? 700 : 600,
                cursor: disabled || pending ? "not-allowed" : "pointer",
                boxShadow: next ? `0 0 0 2px ${t.bg} inset, 0 0 0 1px ${t.bd}` : "none",
                fontFamily: "inherit",
                opacity: disabled || pending ? 0.7 : 1,
              }}
            >
              {done && "✓ "}{active && "● "}{s}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => set("見送り")}
        disabled={disabled || pending || isReject}
        title="この応募を見送りにする（取り消しは元のステージに戻すだけで OK）"
        style={{
          alignSelf: "flex-start",
          padding: "3px 10px",
          border: `1px solid ${TONE.見送り.bd}`,
          background: isReject ? TONE.見送り.bg : "var(--color-surface)",
          color: isReject ? TONE.見送り.fg : "#b42318",
          borderRadius: 99,
          fontSize: 11,
          fontWeight: isReject ? 700 : 600,
          cursor: disabled || pending || isReject ? "not-allowed" : "pointer",
          opacity: disabled || pending ? 0.7 : 1,
          fontFamily: "inherit",
        }}
      >
        {isReject ? "● 見送り" : "× 見送りにする"}
      </button>
    </div>
  );
}
