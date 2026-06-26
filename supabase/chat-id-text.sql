-- ============================================================
-- チャット：ID列の型を text に統一 ＋ スレッドメモ列を追加
--   ・旧テーブルでは sender_id / participant_id / engineer_id が uuid 型（FK・RLS依存あり）
--     のことがあり、email（例: m_fujimoto@8grp.co.jp）を入れると
--     「invalid input syntax for type uuid」で送信に失敗していた。
--     これらは email / engineer_id を入れる想定のため text に統一する。
--   ・uuid→text 変換の前に、対象列に依存する (1)外部キー制約 と (2)RLSポリシー を外す。
--     変換後に RLS ポリシーを auth.uid()::text 比較で作り直す。
--   ・chat_threads.memo：チャット画面左でメモを手入力・保存できるようにする。
--   中央 Supabase の SQL Editor で実行（何度でも安全・冪等）。
-- ============================================================

-- 1) 対象列に付いている外部キー制約を動的に全て外す（制約名が環境で異なっても確実に外す）。
do $$
declare r record;
begin
  for r in
    select tc.constraint_name, tc.table_schema, tc.table_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema   = kcu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'enger'
      and (
        (tc.table_name = 'chat_messages' and kcu.column_name = 'sender_id') or
        (tc.table_name = 'chat_reads'    and kcu.column_name = 'participant_id') or
        (tc.table_name = 'chat_threads'  and kcu.column_name = 'engineer_id') or
        (tc.table_name = 'scouts'        and kcu.column_name = 'engineer_id')
      )
  loop
    execute format('alter table %I.%I drop constraint %I', r.table_schema, r.table_name, r.constraint_name);
  end loop;
end $$;

-- 2) 対象列に依存する RLS ポリシーを外す（変換後に作り直す）。
drop policy if exists chat_threads_update_own  on enger.chat_threads;
drop policy if exists chat_messages_insert_own on enger.chat_messages;
drop policy if exists chat_reads_upsert_own    on enger.chat_reads;
drop policy if exists scouts_update_own        on enger.scouts;

-- 3) email / 識別子を入れる列は text に統一（uuid だった場合のみ実質変換）。
alter table enger.chat_messages alter column sender_id      type text using sender_id::text;
alter table enger.chat_reads    alter column participant_id type text using participant_id::text;
alter table enger.chat_threads  alter column engineer_id    type text using engineer_id::text;
alter table enger.scouts        alter column engineer_id    type text using engineer_id::text;

-- 4) RLS ポリシーを text 比較（auth.uid()::text）で作り直す。
create policy chat_threads_update_own on enger.chat_threads
  for update using (auth.uid()::text = engineer_id) with check (auth.uid()::text = engineer_id);
create policy chat_messages_insert_own on enger.chat_messages
  for insert with check (
    sender_role = 'freelance'
    and exists (select 1 from enger.chat_threads t where t.id = thread_id and t.engineer_id = auth.uid()::text)
  );
create policy chat_reads_upsert_own on enger.chat_reads
  for all using (participant_role = 'freelance' and participant_id = auth.uid()::text)
  with check (participant_role = 'freelance' and participant_id = auth.uid()::text);
create policy scouts_update_own on enger.scouts
  for update using (auth.uid()::text = engineer_id) with check (auth.uid()::text = engineer_id);

-- 5) スレッドメモ（担当者の手入力メモ）。
alter table enger.chat_threads add column if not exists memo text;

-- 確認
-- select id, engineer_id, engineer_name, memo from enger.chat_threads limit 20;
