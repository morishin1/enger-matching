-- 「人材(candidate)」ロールを追加。企業(client)・営業(agent)と並ぶ自己登録区分。
--   人材は承認後、自分用ダッシュボード("/")のみ利用できる（企業ポータルは非表示）。
-- role の CHECK 制約を貼り直し、candidate を許可する。

alter table enger.app_users drop constraint if exists app_users_role_check;
alter table enger.app_users
  add constraint app_users_role_check check (role in ('admin','agent','client','candidate'));

-- 営業区分(inside/outside)を保持する列（コードが参照するが未追加の環境向け）
alter table enger.app_users add column if not exists position text;
