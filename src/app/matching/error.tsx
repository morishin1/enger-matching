"use client";

// マッチング画面のエラーバウンダリ。
//   ここが無いと、サーバ側で1件でも不整合データを踏んだときに真っ白な
//   「This page couldn't load」だけが出て、原因の手がかりが何も残らない。
//   ・利用者には「何が起きたか・次に何をすればよいか」を出す
//   ・調査用に digest（Vercel のログと突き合わせられるID）を画面に出す
import { useEffect } from "react";
import Link from "next/link";

export default function MatchingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[matching] render error:", error); }, [error]);

  return (
    <div className="page">
      <div className="card" style={{ padding: 24, maxWidth: 720 }}>
        <h2 style={{ margin: 0, fontSize: 17, color: "var(--color-danger)" }}>マッチング画面を表示できませんでした</h2>
        <p style={{ fontSize: 13, color: "var(--color-ink-2)", lineHeight: 1.9, marginTop: 10 }}>
          この案件（または人材）のデータで表示処理が止まりました。<b>再読み込み</b>で直ることがあります。
          直らない場合は、下のエラーIDを添えて管理者にお知らせください。案件を選び直す・別の案件から開くことは引き続きできます。
        </p>
        {error.digest && (
          <div className="mono" style={{ fontSize: 12, background: "var(--color-surface-2, #f3f6fa)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
            エラーID: {error.digest}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={reset} className="btn brand" style={{ cursor: "pointer" }}>再読み込み</button>
          <Link href="/matching" className="btn ghost" style={{ textDecoration: "none" }}>マッチングの先頭に戻る</Link>
          <Link href="/jobs" className="btn ghost" style={{ textDecoration: "none" }}>案件一覧へ</Link>
        </div>
      </div>
    </div>
  );
}
