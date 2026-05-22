"use client";

import { useState, useEffect, useRef } from "react";

const KEY = "enger.operator";

/** ログイン中の本人。アカウントに紐づく表示＋メニュー（提案文の差出人にも使用）。 */
export function OperatorBadge({ defaultName = "", email = "", compact = false }: { operators?: string[]; defaultName?: string; email?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = defaultName || "";

  // 操作者（提案文の差出人など）はログイン中の本人に固定
  useEffect(() => { try { if (name) localStorage.setItem(KEY, name); } catch { /* noop */ } }, [name]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const display = name || "アカウント";
  const initials = name ? name.slice(0, 2) : "👤";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {compact ? (
        <button type="button" onClick={() => setOpen((v) => !v)} title={email || display}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: 99, padding: "5px 12px 5px 6px", cursor: "pointer" }}>
          <span className="ava" style={{ width: 26, height: 26, fontSize: 11 }}>{initials}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-ink)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display}</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((v) => !v)} className="side-foot" style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
          <div className="ava">{initials}</div>
          <div className="me">{display}<small>{email || "ログイン中"}</small></div>
        </button>
      )}
      {open && (
        <div style={{ position: "absolute", ...(compact ? { top: "calc(100% + 6px)", right: 0, minWidth: 220 } : { bottom: "calc(100% + 6px)", left: 0, right: 0 }), background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", borderRadius: 12, boxShadow: "0 14px 40px rgba(0,0,0,.16)", padding: 8, zIndex: 200 }}>
          <div style={{ padding: "6px 8px 10px", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink)" }}>{display}</div>
            {email && <div style={{ fontSize: 11, color: "var(--color-ink-4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{email}</div>}
          </div>
          <a href="/settings" onClick={() => setOpen(false)} style={{ display: "block", padding: "8px 10px", color: "var(--color-ink-2)", textDecoration: "none", fontSize: 12.5, borderRadius: 8 }}>設定</a>
          <a href="/api/auth/signout" style={{ display: "block", marginTop: 2, padding: "8px 10px", color: "var(--color-danger)", textDecoration: "none", fontSize: 12.5, borderRadius: 8 }}>ログアウト</a>
        </div>
      )}
    </div>
  );
}
