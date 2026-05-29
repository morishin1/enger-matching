-- enger.jobs に CSV取込・運用で必要な列を追加 (冪等)
-- schema-matching.sql 作成時点で jobs は既存テーブルのため、
-- これらの列が定義されておらず import 時に "column not found" が発生していた。

alter table enger.jobs add column if not exists salary_label  text;
alter table enger.jobs add column if not exists flow_note     text;
alter table enger.jobs add column if not exists work_location text;
alter table enger.jobs add column if not exists start_date    text;
alter table enger.jobs add column if not exists source_csv    text;
alter table enger.jobs add column if not exists imported_at   timestamptz;
alter table enger.jobs add column if not exists rank          text;  -- '-' / 'A' / 'B' / 'C'

-- upsert(onConflict: "title,client_name") に必要な一意制約
create unique index if not exists jobs_title_client_uq on enger.jobs (title, client_name);
