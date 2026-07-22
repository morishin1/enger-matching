-- 0722①：案件の「年齢制限」列（自由記述テキスト。例：「30〜55歳まで」「45歳以下」）。
--   ・案件詳細/一覧ドロワーの編集フォームと、案件CSV（JOB_cleaned.csv）の「希望年齢層」列の取込先。
--   ・マッチング（parseJobAgeLimit / parseJobAgeFloor）はこの列も読んで年齢制限の除外に使う。
--   ・列が無い環境でも保存・取込は fail-soft（この項目だけスキップして通知）で動く。
-- 適用：Supabase SQL Editor で本ファイルを実行。

alter table enger.jobs add column if not exists age_limit text;

comment on column enger.jobs.age_limit is '年齢制限（自由記述。CSVの「希望年齢層」由来。マッチングの年齢除外にも使用）';
