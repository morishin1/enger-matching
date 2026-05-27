-- ============================================================
-- board 連携（④）：稼働(engagement) と board 案件(project) のひもづけ
--   board の請求ステータスを「読み取り」、ENGER 稼働管理の請求「送付状況」を自動更新する。
--   ・読み取り専用（board へは一切書き込まない）
--   ・突合は board の案件ID を稼働ごとに手動設定（board_project_id）
--   ・同期メタ（最終同期時刻など）は app_settings(key='board_sync') に保存
-- ============================================================

alter table enger.engagements add column if not exists board_project_id text;  -- board の案件ID（手動ひもづけ）

create index if not exists engagements_board_project_idx on enger.engagements (board_project_id);

-- app_settings は supabase/app-settings.sql で作成済み（key/value JSON ストア）。
-- 同期実行時に key='board_sync' を upsert します（事前 insert は不要）。

-- 確認
-- select candidate_name, board_project_id from enger.engagements where board_project_id is not null;
-- select * from enger.app_settings where key = 'board_sync';
