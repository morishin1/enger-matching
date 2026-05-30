-- 「面談済み」フラグ。承認(status=active)はランキング/一覧の閲覧を許可するが、
-- 詳細（連絡先・本文）の閲覧はエージェントとの面談後に解放する運用に対応。
-- partner/freelance/candidate ロールでこのフラグを参照する。
alter table enger.app_users add column if not exists meeting_done boolean not null default false;
alter table enger.app_users add column if not exists meeting_done_at timestamptz;
create index if not exists app_users_meeting_done_idx on enger.app_users (meeting_done);

-- 管理者用：面談済み一覧
-- select email, role, name, meeting_done, meeting_done_at from enger.app_users
--   where status='active' and meeting_done = true order by meeting_done_at desc;
