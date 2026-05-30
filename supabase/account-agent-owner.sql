-- 担当エージェント割当＋面談/承認の根拠メモ。
--   担当エージェント：誰が窓口かを残し、その担当が承認・面談済みにする運用に。
--   メモ：承認・面談・連絡履歴の自由記述（簡易ログ）。
alter table enger.app_users add column if not exists owner_agent_email text;
alter table enger.app_users add column if not exists owner_agent_name  text;
alter table enger.app_users add column if not exists note              text;
create index if not exists app_users_owner_agent_idx on enger.app_users (owner_agent_email);

-- 任意：登録時に LP 由来かなどを残せる列（既に enger.jp(profiles) では signup_source/method がある）
alter table enger.app_users add column if not exists signup_source text;
alter table enger.app_users add column if not exists signup_method text;
