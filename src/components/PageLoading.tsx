// 画面遷移時に即座に表示するローディング骨組み。
//   ページ見出し（meta + タイトル）は先に出して「どの画面に来たか」を分かるようにし、
//   本文領域はスピナーで「読み込み中」を明示する。各ルートの loading.tsx から使う。
//   ※ Server Component（フック不使用）なので loading.tsx からそのまま描画できる。

export function PageLoading({ meta, title }: { meta?: string; title: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          {meta && <div className="meta">{meta}</div>}
          <h1>{title}</h1>
        </div>
      </div>
      <div className="loading-wrap">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <div className="t">読み込み中…</div>
        </div>
      </div>
    </div>
  );
}
