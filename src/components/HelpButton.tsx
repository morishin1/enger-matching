"use client";

// 各画面の右上に置く「？ヘルプ」ボタン。現在のURLに応じたマニュアルをモーダルで表示する。
// 文面は src/lib/help-content.ts に集約（機能追加・修正時はそこを更新）。
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { helpFor } from "@/lib/help-content";

export function HelpButton() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const doc = helpFor(pathname);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="icon-btn" title={`${doc.title}の使い方`}
        aria-label="ヘルプ"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "auto", padding: "0 10px", whiteSpace: "nowrap" }}>
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>help</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>ヘルプ</span>
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" role="dialog" aria-modal="true"
            style={{ width: "100%", maxWidth: 560, maxHeight: "86vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <div className="meta" style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--color-ink-4)", fontWeight: 600 }}>HELP · 使い方ガイド</div>
                <h3 style={{ margin: "2px 0 4px", fontSize: 18, fontWeight: 700 }}>{doc.title}</h3>
                <div style={{ fontSize: 12.5, color: "var(--color-ink-3)", lineHeight: 1.7 }}>{doc.intro}</div>
              </div>
              <button className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {doc.sections.map((s, i) => (
                <div key={i} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: "12px 14px", background: "var(--color-surface)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "var(--color-ink)" }}>{s.h}</div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                    {s.body.map((line, j) => (
                      <li key={j} style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--color-ink-2)" }}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 10.5, color: "var(--color-ink-4)" }}>※ このヘルプは画面ごとに内容が切り替わります。機能の追加・変更に合わせて随時更新されます。</div>
          </div>
        </div>
      )}
    </>
  );
}
