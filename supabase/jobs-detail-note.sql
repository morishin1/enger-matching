-- #331⑧：案件に「案件詳細（手入力メモ）」列を追加する。
--   取込メール原文（jobs.detail＝ドロワーでは「メール原文」）とは別に、
--   担当が案件のポイントを手入力で整えるための欄。
--   冪等（何度実行しても安全）。Supabase の SQL Editor で実行してください。
alter table enger.jobs add column if not exists detail_note text;
comment on column enger.jobs.detail_note is '手入力の案件詳細（メール原文=detail とは別の整形メモ）。#331';
