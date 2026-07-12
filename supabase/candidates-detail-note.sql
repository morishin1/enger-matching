-- #347⑤：人材に「人材詳細（手入力メモ）」列を追加する。
--   メール原文（candidates.note＝ドロワーでは「メール原文」）とは別に、担当が人材のポイントを
--   手入力で整えるための欄。案件側の jobs.detail_note と対称。
--   冪等（何度実行しても安全）。Supabase の SQL Editor で実行してください。
alter table enger.candidates add column if not exists detail_note text;
comment on column enger.candidates.detail_note is '手入力の人材詳細（メール原文=note とは別の整形メモ）。#347';
