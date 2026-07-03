"use client";

// 紹介リンク（ログイン→この詳細へ直行するURL）をコピーするボタン。
//   コピーされるURL：/login?redirect=<この詳細のパス>
//   ・ENGER business のアカウントを持つ相手がログインすると、そのままこの詳細ページに着地する。
//   ・テスト用アカウント（設定→ユーザー管理で作成）を案内すれば、本登録前の相手にも見せられる。
//   ・アカウント不要で見せたい場合は「外部共有」（匿名サマリページ）を使う。
import { useState } from "react";

export function IntroLinkButton({ path, label = "紹介リンク", compact = false }: { path: string; label?: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/login?redirect=${encodeURIComponent(path)}`;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      try { window.prompt("紹介リンク（ログイン後にこの詳細へ移動します）", url); } catch { /* noop */ }
    }
  };
  return (
    <button type="button" onClick={onClick} className={`btn ghost${compact ? " btn-xs" : ""}`} style={{ whiteSpace: "nowrap", flexShrink: 0 }}
      title="ログイン画面を経由してこの詳細ページへ直行するURLをコピーします（ENGER business のアカウントでログインが必要。アカウント不要で見せる場合は「外部共有」を使ってください）">
      <span className="material-symbols-outlined" style={{ fontSize: compact ? 14 : 16, verticalAlign: "-3px", marginRight: 3 }}>{done ? "check" : "link"}</span>
      {done ? "コピーしました" : label}
    </button>
  );
}
