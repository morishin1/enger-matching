"use client";

import { useState } from "react";

/** 既定で閉じている折りたたみ。詳細指標などをまとめて隠してダッシュボードを簡潔に。 */
export function Collapsible({ label, children, defaultOpen = false }: { label: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap, 20px)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ alignSelf: "flex-start", border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: 99, padding: "7px 16px", fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-2)", cursor: "pointer", fontFamily: "inherit" }}>
        {open ? "▾ " : "▸ "}{label}
      </button>
      {open && children}
    </div>
  );
}
