"use client";

import { useState, useEffect, useRef } from "react";

const KEY = "enger.operator";

type MenuItem = { label: string; href: string; icon?: string; danger?: boolean };
type MenuGroup = { label?: string; items: MenuItem[] };

/** ログイン中の本人。アカウントに紐づく表示＋メニュー（提案文の差出人にも使用）。 */
export function OperatorBadge({ defaultName = "", email = "", compact = false, role = "admin" }: { operators?: string[]; defaultName?: string; email?: string; compact?: boolean; role?: "admin" | "agent" | "client" }) {
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

  // ロール別メニュー（設定は1ページに束ねず、各セクションへ直接ジャンプ）
  const groups: MenuGroup[] =
    role === "admin"
      ? [
          { label: "管理設定", items: [
            { label: "👤 アカウント・権限管理", href: "/settings#accounts" },
            { label: "🧑‍💼 担当者マスタ", href: "/settings#staff" },
            { label: "🚦 品質ルール", href: "/settings#quality" },
            { label: "🤖 AI使用量・コスト", href: "/settings#ai-usage" },
          ] },
          { label: "ツール", items: [
            { label: "📣 PR・X集客", href: "/pr" },
            { label: "🔔 お知らせ", href: "/notifications" },
            { label: "⚙ 設定トップ", href: "/settings" },
          ] },
        ]
      : role === "agent"
      ? [{ items: [
          { label: "📣 PR・X集客", href: "/pr" },
          { label: "🔔 お知らせ", href: "/notifications" },
        ] }]
      : [{ items: [
          { label: "🏢 企業プロフィール", href: "/portal/company" },
        ] }];

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
          {groups.map((g, gi) => (
            <div key={gi} style={{ paddingTop: gi > 0 ? 6 : 4, marginTop: gi > 0 ? 4 : 0, borderTop: gi > 0 ? "1px solid var(--color-border)" : "none" }}>
              {g.label && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: "var(--color-ink-4)", padding: "2px 10px 4px" }}>{g.label}</div>}
              {g.items.map((it) => (
                <a key={it.href} href={it.href} onClick={() => setOpen(false)} style={{ display: "block", padding: "8px 10px", color: "var(--color-ink-2)", textDecoration: "none", fontSize: 12.5, borderRadius: 8 }}>{it.label}</a>
              ))}
            </div>
          ))}
          <a href="/api/auth/signout" style={{ display: "block", marginTop: 4, paddingTop: 8, padding: "8px 10px", borderTop: "1px solid var(--color-border)", color: "var(--color-danger)", textDecoration: "none", fontSize: 12.5, borderRadius: 8 }}>ログアウト</a>
        </div>
      )}
    </div>
  );
}
