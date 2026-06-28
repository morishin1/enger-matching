-- ============================================================
-- チャット送信不具合の抜本対応（DX→フリーランスの送信が失敗する件）
--   症状：ENGERフリーランスからの受信は見えるが、ENGERDX(担当=agent)からの送信が
--         エラーで失敗する。受信(select)は anon/authenticated に許可されている一方、
--         担当の送信(insert)は service_role でのみ行うため、service_role への grant や
--         列型(text)・RLSポリシー・トリガが本番に未適用だと insert が拒否される。
--   対応：チャット3テーブルの「型(text)・NULL許容・grant・RLS・トリガ」を冪等に再適用する。
--   ※ 中央 Supabase の SQL Editor で実行（何度でも安全・冪等）。chat.sql / chat-id-text.sql の
--     必須部分を1ファイルに集約した“決定版”。これを実行すれば送信が通る状態になる。
-- ============================================================

-- 0) 念のためテーブルが無ければ最低限の形で用意（既存環境では何もしない）。
create table if not exists enger.chat_threads (
  id uuid primary key default gen_random_uuid(),
  engineer_id text, engineer_name text, agent text,
  job_no integer, job_title text, subject text, memo text,
  status text not null default 'open',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists enger.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references enger.chat_threads(id) on delete cascade,
  sender_role text not null, sender_id text, sender_name text, body text not null,
  created_at timestamptz not null default now()
);
create table if not exists enger.chat_reads (
  thread_id uuid not null references enger.chat_threads(id) on delete cascade,
  participant_role text not null, participant_id text not null default '',
  last_read_at timestamptz not null default now(),
  primary key (thread_id, participant_role, participant_id)
);

-- 0.5) 既存テーブルが列欠落で存在しても自己修復（冪等）。新規スレッド作成/送信が使う列を必ず用意する。
--      （CREATE TABLE IF NOT EXISTS は既存テーブルには列を足さないため、ここで個別に補完する。）
alter table enger.chat_threads  add column if not exists scout_id        uuid;
alter table enger.chat_threads  add column if not exists engineer_id     text;
alter table enger.chat_threads  add column if not exists engineer_name   text;
alter table enger.chat_threads  add column if not exists company         text;
alter table enger.chat_threads  add column if not exists company_email   text;
alter table enger.chat_threads  add column if not exists agent           text;
alter table enger.chat_threads  add column if not exists job_no          integer;
alter table enger.chat_threads  add column if not exists job_title       text;
alter table enger.chat_threads  add column if not exists subject         text;
alter table enger.chat_threads  add column if not exists memo            text;
alter table enger.chat_threads  add column if not exists status          text not null default 'open';
alter table enger.chat_threads  add column if not exists last_message_at timestamptz not null default now();
alter table enger.chat_threads  add column if not exists created_at      timestamptz not null default now();
alter table enger.chat_messages add column if not exists sender_role     text;
alter table enger.chat_messages add column if not exists sender_id       text;
alter table enger.chat_messages add column if not exists sender_name     text;
alter table enger.chat_messages add column if not exists body            text;
alter table enger.chat_messages add column if not exists created_at      timestamptz not null default now();

-- 1) email/識別子を入れる列は text に統一（uuid 型だと email を入れられず送信が落ちる）。
--    依存する RLSポリシー と 外部キー制約 を先に外す（外さないと uuid→text の ALTER が失敗し、
--    旧環境では型が uuid のまま残って送信不具合が直らない）。型変換後にポリシーを作り直す。
drop policy if exists chat_threads_update_own  on enger.chat_threads;
drop policy if exists chat_messages_insert_own on enger.chat_messages;
drop policy if exists chat_reads_upsert_own    on enger.chat_reads;

-- 対象列に付いている外部キー制約を動的に全て外す（制約名が環境で異なっても確実に外す）。
--   例：engineer_id → public.profiles.id 等。これが残っていると ALTER COLUMN TYPE が拒否される。
do $$
declare r record;
begin
  for r in
    select tc.constraint_name, tc.table_schema, tc.table_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'enger'
      and (
        (tc.table_name = 'chat_messages' and kcu.column_name = 'sender_id') or
        (tc.table_name = 'chat_reads'    and kcu.column_name = 'participant_id') or
        (tc.table_name = 'chat_threads'  and kcu.column_name = 'engineer_id')
      )
  loop
    execute format('alter table %I.%I drop constraint %I', r.table_schema, r.table_name, r.constraint_name);
  end loop;
end $$;

-- FK を外したので型変換は確実に通る（uuid→text。既に text の場合は実質 no-op）。
alter table enger.chat_messages alter column sender_id      type text using sender_id::text;
alter table enger.chat_reads    alter column participant_id type text using participant_id::text;
alter table enger.chat_threads  alter column engineer_id    type text using engineer_id::text;
-- sender_id は NULL 許容（担当=agent は email を sender_name に残し sender_id は任意）。
alter table enger.chat_messages alter column sender_id drop not null;
alter table enger.chat_threads add column if not exists memo text;

-- enger-lp 由来の chat_messages に sender_kind(NOT NULL) 列があると、dx の送信(sender_kind 未指定)が
--   「null value in column sender_kind violates not-null constraint」で失敗する。
--   dx は sender_role を持つため sender_kind は必須にしない（NULL 許容化。NULL は CHECK も通過する）。
--   列が無い環境では何もしない。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'enger' and table_name = 'chat_messages' and column_name = 'sender_kind'
  ) then
    begin alter table enger.chat_messages alter column sender_kind drop not null; exception when others then null; end;
  end if;
end $$;

-- 1.6) 【抜本対応】dx が値を入れない NOT NULL 列で insert(新規スレッド作成・送信)が落ちるのを一般化して防ぐ。
--   chat_threads / chat_messages のうち「NOT NULL かつ default 無し」で、dx が必ず入れる構造的必須列
--   （id/thread_id/engineer_id/sender_role/body）以外の列を NULL 許容にする。
--   enger-lp 側は自身の insert で各列に値を入れるため影響は無い（NULL は CHECK も通過する）。
--   これにより enger-lp 由来の未知の必須列（例：sender_kind 等）にも将来含めて対応できる。
do $$
declare r record;
begin
  for r in
    select table_name, column_name from information_schema.columns
    where table_schema = 'enger' and table_name in ('chat_threads','chat_messages')
      and is_nullable = 'NO' and column_default is null
      and column_name not in ('id','thread_id','engineer_id','sender_role','body')
  loop
    begin
      execute format('alter table enger.%I alter column %I drop not null', r.table_name, r.column_name);
    exception when others then null;
    end;
  end loop;
end $$;

-- 2) RLS 有効化。
alter table enger.chat_threads  enable row level security;
alter table enger.chat_messages enable row level security;
alter table enger.chat_reads    enable row level security;

-- 3) 読取（dx は anon/service で広く閲覧）。
drop policy if exists chat_threads_read  on enger.chat_threads;
create policy chat_threads_read  on enger.chat_threads  for select using (true);
drop policy if exists chat_messages_read on enger.chat_messages;
create policy chat_messages_read on enger.chat_messages for select using (true);
drop policy if exists chat_reads_read    on enger.chat_reads;
create policy chat_reads_read    on enger.chat_reads    for select using (true);

-- 4) 本人(フリーランス, authenticated)が自分のスレッドに freelance として投稿/既読化できる。
--    （担当=agent の送信は service_role で行うため、ここにポリシーは不要＝service_role は RLS をバイパス。）
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

-- 5) 権限付与（最重要）。dx の送信は service_role 経由。enger スキーマでは明示 grant が必須。
grant usage on schema enger to anon, authenticated, service_role;
grant select on enger.chat_threads, enger.chat_messages, enger.chat_reads to anon, authenticated;
grant insert, update on enger.chat_messages to authenticated;
grant insert, update, delete on enger.chat_reads to authenticated;
grant update on enger.chat_threads to authenticated;
-- service_role（dx の送信・スレッド作成・既読更新・削除）に全権限。これが無いと dx 送信が失敗する。
grant all on enger.chat_threads, enger.chat_messages, enger.chat_reads to service_role;

-- 6) メッセージ投入でスレッドの last_message_at を更新（一覧の最新順）。
create or replace function enger.touch_chat_thread() returns trigger
  language plpgsql as $$
begin
  update enger.chat_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end $$;
drop trigger if exists chat_messages_touch on enger.chat_messages;
create trigger chat_messages_touch after insert on enger.chat_messages
  for each row execute function enger.touch_chat_thread();

-- 確認：担当として1件入れて成功するか（thread_id は実在のスレッドIDに置換）。
-- insert into enger.chat_messages (thread_id, sender_role, sender_name, body)
--   values ('00000000-0000-0000-0000-000000000000', 'agent', 'テスト担当', 'テスト送信') returning id;
