-- ============================================================
-- チャット（スカウト→往復メッセージ）— enger.chat_threads / chat_messages / chat_reads
--   営業(dx)が間に入る「企業 × フリーランス × 担当営業」の3者スレッド。
--   ・スカウト(enger.scouts)送信を起点にスレッドを自動生成（scout_id で連携）。
--   ・企業には人材を匿名表示する現行ルールを維持するため、連絡先は本文に出さず
--     当事者の表示名スナップショットのみ保持する（氏名/連絡先の開示は担当が仲介）。
--   ・既読は参加者ごとの last_read_at で判定（chat_reads）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- ---- スレッド本体 -------------------------------------------------
create table if not exists enger.chat_threads (
  id            uuid primary key default gen_random_uuid(),
  scout_id      uuid,                          -- 起点スカウト enger.scouts.id（任意）
  engineer_id   uuid not null,                 -- フリーランス public.profiles.id
  engineer_name text,                          -- 表示名スナップショット（匿名表示用イニシャル等）
  company       text,                          -- 企業名（client 側の表示名）
  company_email text,                          -- 企業アカウントのメール（RLS/識別用・任意）
  agent         text,                          -- 間に入る担当営業（氏名 or メール）
  job_no        integer,                       -- 対象案件 No.（任意）
  job_title     text,                          -- 対象案件名スナップショット（任意）
  subject       text,                          -- スレッド見出し（任意）
  status        text not null default 'open',  -- open | closed
  last_message_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
-- 既存テーブルが列なしで存在しても自己修復できるよう、列を個別に補完する（冪等）。
alter table enger.chat_threads add column if not exists scout_id        uuid;
alter table enger.chat_threads add column if not exists engineer_id     uuid;
alter table enger.chat_threads add column if not exists engineer_name   text;
alter table enger.chat_threads add column if not exists company         text;
alter table enger.chat_threads add column if not exists company_email   text;
alter table enger.chat_threads add column if not exists agent           text;
alter table enger.chat_threads add column if not exists job_no          integer;
alter table enger.chat_threads add column if not exists job_title       text;
alter table enger.chat_threads add column if not exists subject         text;
alter table enger.chat_threads add column if not exists status          text not null default 'open';
alter table enger.chat_threads add column if not exists last_message_at timestamptz not null default now();
alter table enger.chat_threads add column if not exists created_at      timestamptz not null default now();
create index if not exists chat_threads_engineer_idx on enger.chat_threads (engineer_id, last_message_at desc);
create index if not exists chat_threads_company_idx   on enger.chat_threads (company, last_message_at desc);
create index if not exists chat_threads_scout_idx     on enger.chat_threads (scout_id);
-- 同一スカウトからスレッドを重複生成しない（scout_id がある場合のみ一意）。
create unique index if not exists chat_threads_scout_uniq on enger.chat_threads (scout_id) where scout_id is not null;

-- ---- メッセージ ---------------------------------------------------
create table if not exists enger.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references enger.chat_threads (id) on delete cascade,
  sender_role text not null,                   -- 'company' | 'freelance' | 'agent'
  sender_id   text,                            -- 送信者識別（email or engineer_id・任意）
  sender_name text,                            -- 表示名スナップショット
  body        text not null,
  created_at  timestamptz not null default now()
);
-- 列の自己修復（冪等）。
alter table enger.chat_messages add column if not exists thread_id   uuid;
alter table enger.chat_messages add column if not exists sender_role text;
alter table enger.chat_messages add column if not exists sender_id   text;
alter table enger.chat_messages add column if not exists sender_name text;
alter table enger.chat_messages add column if not exists body        text;
alter table enger.chat_messages add column if not exists created_at  timestamptz not null default now();
create index if not exists chat_messages_thread_idx on enger.chat_messages (thread_id, created_at);

-- メッセージ投入時にスレッドの last_message_at を更新（一覧の並びを最新順に保つ）。
create or replace function enger.touch_chat_thread() returns trigger
  language plpgsql as $$
begin
  update enger.chat_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end $$;
drop trigger if exists chat_messages_touch on enger.chat_messages;
create trigger chat_messages_touch after insert on enger.chat_messages
  for each row execute function enger.touch_chat_thread();

-- ---- 既読（参加者ごとの最終既読時刻）------------------------------
create table if not exists enger.chat_reads (
  thread_id        uuid not null references enger.chat_threads (id) on delete cascade,
  participant_role text not null,              -- 'company' | 'freelance' | 'agent'
  participant_id   text not null default '',   -- email or engineer_id（agent はメール）
  last_read_at     timestamptz not null default now(),
  primary key (thread_id, participant_role, participant_id)
);
-- 列の自己修復（冪等）。
alter table enger.chat_reads add column if not exists participant_id text not null default '';
alter table enger.chat_reads add column if not exists last_read_at   timestamptz not null default now();

-- ============================================================
-- RLS（既存 scouts.sql と同方針）
--   ・dx(営業/企業) は anon キーで読取するため select は広く許可。
--   ・書込はサーバ(service_role)経由。
--   ・本人(フリーランス, enger.jp) は自分が当事者のスレッドのみ読取/投稿/既読化できる。
-- ============================================================
alter table enger.chat_threads  enable row level security;
alter table enger.chat_messages enable row level security;
alter table enger.chat_reads    enable row level security;

drop policy if exists chat_threads_read on enger.chat_threads;
create policy chat_threads_read on enger.chat_threads for select using (true);
-- 本人(フリーランス)が自分宛スレッドのステータス等を更新できるよう許可。
drop policy if exists chat_threads_update_own on enger.chat_threads;
create policy chat_threads_update_own on enger.chat_threads
  for update using (auth.uid() = engineer_id) with check (auth.uid() = engineer_id);

drop policy if exists chat_messages_read on enger.chat_messages;
create policy chat_messages_read on enger.chat_messages for select using (true);
-- 本人(フリーランス)が自分が当事者のスレッドに freelance として投稿できる。
drop policy if exists chat_messages_insert_own on enger.chat_messages;
create policy chat_messages_insert_own on enger.chat_messages
  for insert with check (
    sender_role = 'freelance'
    and exists (select 1 from enger.chat_threads t where t.id = thread_id and t.engineer_id = auth.uid())
  );

drop policy if exists chat_reads_read on enger.chat_reads;
create policy chat_reads_read on enger.chat_reads for select using (true);
-- 本人(フリーランス)が自分の既読を upsert できる。
drop policy if exists chat_reads_upsert_own on enger.chat_reads;
create policy chat_reads_upsert_own on enger.chat_reads
  for all using (participant_role = 'freelance' and participant_id = auth.uid()::text)
  with check (participant_role = 'freelance' and participant_id = auth.uid()::text);

grant select on enger.chat_threads, enger.chat_messages, enger.chat_reads to anon, authenticated;
grant insert, update on enger.chat_messages to authenticated;
grant insert, update, delete on enger.chat_reads to authenticated;
grant update on enger.chat_threads to authenticated;
grant all on enger.chat_threads, enger.chat_messages, enger.chat_reads to service_role;

-- 確認
-- select t.company, t.engineer_name, t.agent, t.status, t.last_message_at,
--        (select count(*) from enger.chat_messages m where m.thread_id = t.id) as msgs
-- from enger.chat_threads t order by t.last_message_at desc limit 20;
