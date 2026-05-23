-- ============================================================
-- スカウト — enger.scouts
--   dx(営業)が enger.jp 登録エンジニアへスカウトを送り、
--   エンジニアが LP(/scout) で受信・返信(興味あり/見送り)する。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.scouts (
  id            uuid primary key default gen_random_uuid(),
  engineer_id   uuid not null,                -- 宛先 public.profiles.id
  engineer_name text,                         -- 表示名スナップショット
  agent         text,                         -- 送信した営業（氏名 or メール）
  job_title     text,                         -- 対象案件名（任意）
  message       text not null,                -- スカウト本文
  status        text not null default 'sent', -- sent | read | interested | declined
  reply         text,                         -- エンジニアの返信メモ（任意）
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  replied_at    timestamptz
);
create index if not exists scouts_engineer_idx on enger.scouts (engineer_id, created_at desc);

alter table enger.scouts enable row level security;

-- 営業(dx)は anon キーで一覧取得するため select を許可（既存 meetings / engineer_actions と同方針）。
drop policy if exists scouts_read on enger.scouts;
create policy scouts_read on enger.scouts for select using (true);

-- 本人(エンジニア)が自分宛のスカウトを既読化/返信できるよう update を許可。
drop policy if exists scouts_update_own on enger.scouts;
create policy scouts_update_own on enger.scouts
  for update using (auth.uid() = engineer_id) with check (auth.uid() = engineer_id);

grant select on enger.scouts to anon, authenticated;
grant update on enger.scouts to authenticated;
grant all on enger.scouts to service_role;

-- 確認
-- select engineer_name, agent, job_title, status, created_at
-- from enger.scouts order by created_at desc limit 20;
