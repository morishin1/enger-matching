import NextLink from "next/link";
import type { ComponentProps } from "react";

// プロジェクト共通 Link。既定で prefetch を無効化する。
//
// 背景: Next.js の <Link> は既定で表示中の全リンクを先読み(prefetch)する。本アプリは
//   サイドバー・進め方バー・一覧(マッチング/案件/人材)・提案ボード等にリンクが多数あり、
//   それらが画面表示のたびに force-dynamic ページ(認証+DBクエリ)を一斉に同時実行していた。
//   結果、Vercel の同時実行が混雑して一番重い /proposals が「読み込み中…」のまま開かず、
//   認証/DBリクエストも過多(数千/時)になっていた。
//
//   そこで Link の既定を prefetch={false}（実クリック時のみ取得）に変える。先読みの恩恵が
//   欲しい個別箇所は <Link prefetch> を明示すれば従来どおり有効化できる（props が後勝ち）。
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
