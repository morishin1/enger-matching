-- ============================================================
-- チャット：ID列の型を text に統一 ＋ スレッドメモ列を追加
--   ・旧テーブルでは sender_id / participant_id / engineer_id が uuid 型のことがあり、
--     営業の email（例: m_fujimoto@8grp.co.jp）を入れると
--     「invalid input syntax for type uuid」で送信に失敗していた。
--     これらは email / engineer_id を入れる想定のため text に統一する（冪等）。
--   ・chat_threads.memo：チャット画面左でメモを手入力・保存できるようにする。
--   中央 Supabase の SQL Editor で実行（何度でも安全）。
-- ============================================================

-- email / 識別子を入れる列は text に統一（uuid だった場合のみ実質変換）。
alter table enger.chat_messages alter column sender_id      type text using sender_id::text;
alter table enger.chat_reads    alter column participant_id type text using participant_id::text;
alter table enger.chat_threads  alter column engineer_id    type text using engineer_id::text;
alter table enger.scouts        alter column engineer_id    type text using engineer_id::text;

-- スレッドメモ（担当者の手入力メモ）。
alter table enger.chat_threads add column if not exists memo text;

-- 確認
-- select id, engineer_id, engineer_name, memo from enger.chat_threads limit 20;
