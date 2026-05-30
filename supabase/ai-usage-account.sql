-- AI使用ログに「どのアカウントが使ったか」を記録する列を追加。
-- AI再ランキングの「1日1アカウント3回まで」制限のカウントに使う。
alter table enger.ai_usage add column if not exists account text;
create index if not exists ai_usage_account_feature_idx on enger.ai_usage (account, feature, created_at);
