-- アカウントに「職能（複数）」を追加（兼務対応）
alter table enger.app_users add column if not exists functions text[] not null default '{}';
-- 確認
-- select email, role, position, functions from enger.app_users;
