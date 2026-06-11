"use client";

import { useState } from "react";

// 現在のマッチング画面（選択中の案件/人材・タブを含む URL）をクリップボードへコピーするボタン。
//   path 未指定なら window.location.href（今表示している URL）をそのままコピーする。
export function CopyLinkButton({ label = "URLをコピー", path }: { label?: string; path?: string }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    if (typeof window === "undefined") return;
    const url = path ? window.location.origin + path : window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // クリップボード非対応環境では選択用に prompt 表示（フォールバック）
      try { window.prompt("このマッチングのURL", url); } catch { /* noop */ }
    }
  };
  return (
    <button type="button" onClick={onClick} className="btn ghost" style={{ flexShrink: 0, whiteSpace: "nowrap" }}
      title="このマッチングのURLをコピー（選択中の案件・人材ごと共有できます）">
      <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: "-3px" }}>{done ? "check" : "link"}</span>
      {done ? " コピーしました" : ` ${label}`}
    </button>
  );
}
