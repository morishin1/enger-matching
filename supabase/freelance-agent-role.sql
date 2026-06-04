-- 副業エージェント(freelance)ロール。ag.enger.jp から登録する個人エージェント。
--   パートナー企業(partner)と同じテナント隔離で、owner_company には「本人メール」を入れる。
--   自分が登録した案件/人材＋共有のみ閲覧でき、他社は匿名表示（漏洩防止）。
alter table enger.app_users drop constraint if exists app_users_role_check;
alter table enger.app_users
  add constraint app_users_role_check check (role in ('admin','agent','client','candidate','partner','freelance'));
