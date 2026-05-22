// 全ページ共通のローディング表示 (サイドバーは残り、メイン領域にスピナー)
export default function Loading() {
  return (
    <div className="page">
      <div className="loading-wrap">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <div className="t">読み込み中…</div>
        </div>
      </div>
    </div>
  );
}
