-- ============================================================
-- アカウント / 権限ロール  enger.app_users
--   3ロール: admin(管理者) / agent(営業・エージェント) / client(ユーザー企業)
--   自己登録 → status='pending' で保留 → 管理者が承認(active)するとログイン可。
--   client は company_name で自社の案件(jobs.client_name)に名寄せ。
-- ============================================================

create table if not exists enger.app_users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  name         text,
  role         text not null default 'client'  check (role   in ('admin','agent','client')),
  status       text not null default 'pending' check (status in ('pending','active','disabled')),
  company_name text,                         -- client企業の名寄せキー(companies.name / jobs.client_name)
  note         text,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);

-- 再実行用（既存テーブルへの追加）
alter table enger.app_users add column if not exists company_name text;
alter table enger.app_users add column if not exists note         text;
alter table enger.app_users add column if not exists approved_at  timestamptz;

create index if not exists app_users_email_idx  on enger.app_users (lower(email));
create index if not exists app_users_status_idx on enger.app_users (status);

alter table enger.app_users enable row level security;
-- 読み取りはサーバ専用(service_role)で行うため anon には開けない（アカウント一覧の漏洩防止）。
drop policy if exists app_users_admin_all on enger.app_users;
grant all on enger.app_users to service_role;

-- 初期管理者を登録（あなたのメールに置き換えて実行してください）。
-- insert into enger.app_users (email, name, role, status, approved_at)
--   values ('you@example.com', '管理者', 'admin', 'active', now())
--   on conflict (email) do update set role='admin', status='active', approved_at=now();

-- 確認
-- select email, name, role, status, company_name from enger.app_users order by created_at desc;
