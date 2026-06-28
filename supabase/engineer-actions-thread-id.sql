-- ============================================================
-- 対応履歴（enger.engineer_actions）に chat スレッドへの紐づけ列を追加。
--   ・スカウト送信／チャット開始 の対応履歴から、該当チャットスレッドへ直接遷移できるようにする。
--   ・thread_id は chat_threads.id（UUID）。列が無い旧環境でも安全な冪等マイグレーション。
--   ※ 中央 Supabase の SQL Editor で実行（何度でも安全・冪等）。
-- ============================================================

alter table enger.engineer_actions add column if not exists thread_id text;

-- 確認
-- select action, thread_id, created_at from enger.engineer_actions
--   where thread_id is not null order by created_at desc limit 20;
