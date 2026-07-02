"use client";

// 外部共有ページの操作列（閲覧者向け）。印刷（=PDF保存）とテキストコピー。印刷時は非表示(.no-print)。
import { useState } from "react";

export function ShareToolbar({ copyText }: { copyText: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try { window.prompt("以下をコピーしてください", copyText); } catch { /* noop */ }
    }
  };
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
      <button type="button" className="btn brand" onClick={() => window.print()} title="ブラウザの印刷ダイアログからPDFとして保存できます">
        <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px", marginRight: 4 }}>picture_as_pdf</span>
        PDF保存 / 印刷
      </button>
      <button type="button" className="btn ghost" onClick={copy} title="この内容を整理されたテキストとしてコピー">
        <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px", marginRight: 4 }}>{copied ? "check" : "content_copy"}</span>
        {copied ? "コピーしました" : "テキストをコピー"}
      </button>
    </div>
  );
}
