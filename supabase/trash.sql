-- ゴミ箱（ソフトデリート）対応。jobs / candidates に deleted_at を追加し、
-- 「削除」を完全削除ではなく deleted_at をセットする方式に変える。
--   ・null = 通常表示
--   ・not null = ゴミ箱（一覧・マッチング・件数からは除外、ゴミ箱画面でのみ表示）
-- 完全削除（purge）はゴミ箱画面から admin が実行する。
--
-- 既存のレコード（deleted_at が null）はそのまま「通常」扱い。

alter table enger.jobs       add column if not exists deleted_at timestamptz;
alter table enger.candidates add column if not exists deleted_at timestamptz;

-- 通常クエリは deleted_at is null で絞り込む。partial index で高速に。
create index if not exists jobs_deleted_at_null_idx       on enger.jobs       (created_at desc) where deleted_at is null;
create index if not exists candidates_deleted_at_null_idx on enger.candidates (created_at desc) where deleted_at is null;
-- ゴミ箱一覧用
create index if not exists jobs_deleted_at_idx       on enger.jobs       (deleted_at desc) where deleted_at is not null;
create index if not exists candidates_deleted_at_idx on enger.candidates (deleted_at desc) where deleted_at is not null;

comment on column enger.jobs.deleted_at       is 'ゴミ箱（ソフトデリート）。null=通常、値あり=ゴミ箱。';
comment on column enger.candidates.deleted_at is 'ゴミ箱（ソフトデリート）。null=通常、値あり=ゴミ箱。';
