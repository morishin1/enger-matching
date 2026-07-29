"use client";

// 軽量トースト（画面下中央・非ブロッキング）。alert() の置き換え用。
//   どのクライアントコンポーネントからでも `toast("保存しました", "success")` で呼べる。
//   表示本体 <Toaster/> は AppShell に1つだけ設置する（module-level pub/sub で連携）。

import { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind };

let _seq = 0;
const listeners = new Set<(t: ToastItem) => void>();

/** どこからでも呼べる非ブロッキング通知。空文字は無視。 */
/** @client-only ブラウザ側でのみ使う（サーバーコンポーネントからは呼ばない）。 */
export function toast(message: string, kind: ToastKind = "info") {
  const msg = String(message ?? "").trim();
  if (!msg) return;
  const item: ToastItem = { id: ++_seq, message: msg, kind };
  listeners.forEach((fn) => fn(item));
}

const STYLE: Record<ToastKind, { bg: string; icon: string }> = {
  success: { bg: "#067647", icon: "check_circle" },
  error: { bg: "#b42318", icon: "error" },
  info: { bg: "#334155", icon: "info" },
};

/** 画面下中央にトーストを重ねて表示。AppShell に1つだけ設置する。 */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((cur) => [...cur, t]);
      const ttl = t.kind === "error" ? 5000 : 3200; // エラーは少し長め
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), ttl);
    };
    listeners.add(onToast);
    return () => { listeners.delete(onToast); };
  }, []);
  const dismiss = (id: number) => setItems((cur) => cur.filter((x) => x.id !== id));

  return (
    <div aria-live="polite" style={{
      position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
      zIndex: 9999, display: "flex", flexDirection: "column", gap: 8,
      alignItems: "center", pointerEvents: "none", width: "max-content", maxWidth: "92vw",
    }}>
      {items.map((t) => {
        const s = STYLE[t.kind];
        return (
          <div key={t.id} role="status" onClick={() => dismiss(t.id)} title="クリックで閉じる"
            style={{
              pointerEvents: "auto", cursor: "pointer", background: s.bg, color: "#fff",
              padding: "10px 16px", borderRadius: 10, boxShadow: "0 6px 24px rgba(15,23,42,0.28)",
              fontSize: 13.5, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "92vw",
            }}>
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 19 }}>{s.icon}</span>
            <span style={{ whiteSpace: "pre-wrap" }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
