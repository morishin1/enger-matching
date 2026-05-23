-- ============================================================
-- お知らせ  enger.notifications
--   管理者からのフィードバック等を本人に通知。ベル→/notifications で確認。
-- ============================================================

create table if not exists enger.notifications (
  id         uuid primary key default gen_random_uuid(),
  recipient  text not null,                 -- 受信者の氏名（'all' で全員）
  title      text not null,
  body       text,
  kind       text default 'feedback',       -- feedback / info
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists notifications_recipient_idx on enger.notifications (recipient, created_at desc);

alter table enger.notifications enable row level security;
grant all on enger.notifications to service_role;
grant select on enger.notifications to anon, authenticated;
drop policy if exists notifications_read on enger.notifications;
create policy notifications_read on enger.notifications for select using (true);

-- 確認
-- select recipient, title, created_at, read_at from enger.notifications order by created_at desc;
