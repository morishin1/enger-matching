-- 組織構造（部署 × チーム役職）。日報の閲覧/返信権限の制御に使う。
--   department : ITS / バックオフィス / サポート / 開発 / 経営 / フリーランス
--   team_role  : manager（部署マネージャー）/ leader（リーダー）/ member（メンバー）
-- 権限の考え方:
--   admin                         → 全員の日報を閲覧・返信
--   team_role=manager / leader    → 自部署メンバーの日報を閲覧・返信
--   それ以外                      → 自分の日報のみ
alter table enger.app_users add column if not exists department text;
alter table enger.app_users add column if not exists team_role text;

comment on column enger.app_users.department is '所属部署：ITS / バックオフィス / サポート / 開発 / 経営 / フリーランス';
comment on column enger.app_users.team_role  is 'チーム役職：manager / leader / member';
