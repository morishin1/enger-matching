-- ============================================================
-- お問い合わせ — enger.contact_messages
--   enger.jp の問い合わせフォーム送信を中央Supabaseに保存し、
--   dx（管理画面）の受信箱で確認・対応する。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  company    text,
  name       text,
  email      text,
  phone      text,
  topic      text,                          -- 種別（資料請求 / 相談 等）
  role       text,                          -- 採用職種など
  message    text,
  source     text,                          -- 流入元（Webフォーム / business 等）
  status     text not null default 'new',   -- new / inprogress / done
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_created_idx on enger.contact_messages (created_at desc);
create index if not exists contact_messages_status_idx on enger.contact_messages (status);

alter table enger.contact_messages enable row level security;
drop policy if exists contact_messages_read on enger.contact_messages;
create policy contact_messages_read on enger.contact_messages for select using (true);
grant select on enger.contact_messages to anon, authenticated;
grant all on enger.contact_messages to service_role;

-- 確認
-- select company, name, topic, status, created_at from enger.contact_messages order by created_at desc limit 20;
