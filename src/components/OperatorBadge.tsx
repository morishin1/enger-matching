"use client";

import { useState, useEffect, useRef } from "react";

const KEY = "enger.operator";

/** いま操作している担当者。担当者マスタから選択し、この端末に記憶する。 */
export function OperatorBadge({ operators = [], defaultName = "", compact = false }: { operators?: string[]; defaultName?: string; compact?: boolean }) {
  const [name, setName] = useState<string>("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 保存があればそれ、無ければログイン中ユーザー(defaultName)を初期表示
  useEffect(() => { try { setName(localStorage.getItem(KEY) || defaultName || ""); } catch { setName(defaultName || ""); } }, [defaultName]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (n: string) => {
    setName(n);
    try { n ? localStorage.setItem(KEY, n) : localStorage.removeItem(KEY); } catch { /* noop */ }
    setOpen(false);
  };

  const initials = name ? name.slice(0, 2) : "👤";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {compact ? (
        <button type="button" onClick={() => setOpen((v) => !v)} title="操作中の担当者"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: 99, padding: "5px 12px 5px 6px", cursor: "pointer" }}>
          <span className="ava" style={{ width: 26, height: 26, fontSize: 11 }}>{initials}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: name ? "var(--color-ink)" : "var(--color-ink-4)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "担当を選択"}</span>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((v) => !v)} className="side-foot" style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
          <div className="ava">{initials}</div>
          <div className="me">
            {name || "担当を選択"}
            <small>{name ? "マッチング担当" : "クリックして選択"}</small>
          </div>
        </button>
      )}
      {open && (
        <div style={{ position: "absolute", ...(compact ? { top: "calc(100% + 6px)", right: 0, minWidth: 200 } : { bottom: "calc(100% + 6px)", left: 0, right: 0 }), background: "var(--color-surface)", border: "1px solid var(--color-border-strong)", borderRadius: 12, boxShadow: "0 14px 40px rgba(0,0,0,.16)", padding: 6, maxHeight: 280, overflowY: "auto", zIndex: 200 }}>
          <div style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 600, padding: "6px 8px" }}>操作中の担当者</div>
          {operators.length === 0 && <div style={{ fontSize: 11.5, color: "var(--color-ink-4)", padding: "6px 8px" }}>設定 → 担当者マスタで追加</div>}
          {operators.map((o) => (
            <button key={o} type="button" onClick={() => pick(o)} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: o === name ? "var(--color-brand-25)" : "transparent", color: "var(--color-ink)", padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
              {o}{o === name ? " ✓" : ""}
            </button>
          ))}
          {name && <button type="button" onClick={() => pick("")} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", color: "var(--color-ink-4)", padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>未選択に戻す</button>}
          <a href="/api/auth/signout" style={{ display: "block", borderTop: "1px solid var(--color-border)", marginTop: 4, paddingTop: 8, padding: "8px 10px", color: "var(--color-danger)", textDecoration: "none", fontSize: 12.5 }}>ログアウト</a>
        </div>
      )}
    </div>
  );
}
