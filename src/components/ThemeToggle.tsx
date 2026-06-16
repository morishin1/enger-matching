"use client";

// サイドバー下部のダークモード切替トグル。
//   html[data-theme="dark"] を付け外しし、選択は localStorage("enger.theme") に保存。
//   初期反映はレイアウトに埋め込んだ <script> で行うため、ここでは現在状態の読み取りと切替だけを担当。

import { useEffect, useState } from "react";

const KEY = "enger.theme";

function applyTheme(t: "light" | "dark") {
  const root = document.documentElement;
  if (t === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(cur);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem(KEY, next); } catch { /* noop */ }
  };

  const isDark = theme === "dark";
  return (
    <button type="button" onClick={toggle}
      title={isDark ? "ライトモードに切替" : "ダークモードに切替"}
      aria-label={isDark ? "ライトモードに切替" : "ダークモードに切替"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        width: "100%", padding: "8px 12px", marginTop: 8,
        background: "transparent", border: "1px solid var(--color-border)", borderRadius: 10,
        color: "var(--color-ink-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
        fontFamily: "inherit",
      }}>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-ink-3)" }}>
        {isDark ? "light_mode" : "dark_mode"}
      </span>
      <span>{isDark ? "ライトモード" : "ダークモード"}</span>
    </button>
  );
}
