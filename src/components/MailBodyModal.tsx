"use client";

import { useState } from "react";

/** 取り込んだメール本文（案件詳細）をモーダルで表示。Gmailを開かずに内容を確認できる。 */
export function MailBodyModal({ body, title, sub, mailUrl }: { body?: string | null; title?: string | null; sub?: string | null; mailUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const text = String(body ?? "").trim();
  if (!text) return null;

  return (
    <>
      <button type="button" className="btn ghost btn-xs" title="取り込んだメール本文（案件詳細）を表示" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>📄 本文</button>
      {open && (
        <div onClick={(e) => { e.stopPropagation(); setOpen(false); }} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "grid", placeItems: "center", zIndex: 400, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 680, maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title || "メール本文"}</h3>
                {sub && <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
              </div>
              <button type="button" className="btn ghost btn-xs" onClick={() => setOpen(false)}>閉じる</button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.8, color: "var(--color-ink-2)", margin: 0, background: "var(--color-surface-inset)", borderRadius: 10, padding: 14 }}>{text}</pre>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {mailUrl && <a href={mailUrl} target="_blank" rel="noreferrer" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>↗ 元メールを開く</a>}
              <span className="muted" style={{ fontSize: 10.5 }}>※ 取り込み時に保存した本文です（最新の往復はGmailをご確認ください）</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
