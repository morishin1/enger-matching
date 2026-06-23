-- 提案管理(/proposals)の表示を高速化する索引。
--
-- 背景:
--   提案ページのメインクエリは `select ... from proposals order by created_at desc limit 400`、
--   「提案開始件数」の集計は `created_at >= 〇〇` の COUNT を複数回行う。ところが proposals には
--   created_at の通常索引が無く（あるのは approval_status='pending' 限定の部分索引のみ）、
--   フィルタ無しの ORDER BY / 範囲 COUNT がいずれも全表スキャン＋ソートになる。データが増えると
--   ここが急に重くなり、提案管理の TTFB が 1.9 秒まで悪化していた（inbox_emails と同じ索引欠落）。
--
-- 適用: 中央 Supabase の SQL Editor でこのファイルを実行（再実行可・既存環境に安全に追加できる）。

-- メインクエリ（order by created_at desc limit）・件数COUNT（created_at >= X）の両方が使える索引。
create index if not exists proposals_created_at_idx
  on enger.proposals (created_at desc);

analyze enger.proposals;
