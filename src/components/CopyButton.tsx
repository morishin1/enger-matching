"use client";

// クリップボードコピーの最小ボタン。LINE 返信テンプレ・短いメッセージなど、
//   ワンクリックで貼り付け先に持っていきたい箇所で再利用する。
//   ・成功時は「コピーしました」を 1.4秒だけ表示してフェード（無遷移）。
//   ・clipboard API が無い環境（古いブラウザ / 非セキュアコンテキスト）は
//     textarea + execCommand("copy") にフォールバックする。
import { useState } from "react";

export function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); document.body.removeChild(ta);
      }
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch { /* ignore */ }
  };
  return (
    <button type="button" onClick={onClick} className="btn ghost btn-xs"
      style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}>
      <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>{done ? "check" : "content_copy"}</span>
      {done ? "コピーしました" : label}
    </button>
  );
}
