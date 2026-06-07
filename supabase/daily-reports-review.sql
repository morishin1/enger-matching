-- 日報の閲覧チェック列。
--   役割別に独立して持つ：
--     reviewed_by_admin_at      : 管理者(admin)が「確認した」を押した日時
--     reviewed_by_admin_email   : 押した管理者
--     reviewed_by_manager_at    : マネージャー(team_role=manager/leader)が「確認した」を押した日時
--     reviewed_by_manager_email : 押したマネージャー
--   管理者のチェック状態とマネージャーのチェック状態は独立（互いに影響しない）。

alter table enger.daily_reports
  add column if not exists reviewed_by_admin_at      timestamptz,
  add column if not exists reviewed_by_admin_email   text,
  add column if not exists reviewed_by_admin_name    text,
  add column if not exists reviewed_by_manager_at    timestamptz,
  add column if not exists reviewed_by_manager_email text,
  add column if not exists reviewed_by_manager_name  text;

-- 未確認の絞り込みを高速化（管理者向け / マネージャー向け）。
create index if not exists daily_reports_admin_unreviewed_idx
  on enger.daily_reports (created_at desc) where reviewed_by_admin_at is null;

create index if not exists daily_reports_manager_unreviewed_idx
  on enger.daily_reports (created_at desc) where reviewed_by_manager_at is null;
