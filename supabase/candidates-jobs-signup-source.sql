-- ============================================================
-- 人材(enger.candidates)・案件(enger.jobs) に「登録経路」列を追加 (冪等)
--   ・LINE 経由で新規登録したものを LINE登録（signup_source='line'）として識別する。
--   ・LINE登録タブ(/line) は proposals.source='line' に加え、ここの signup_source='line' も拾う。
--   ・未適用でもアプリは fail-soft で動く（この列を外して登録する）。適用すると LINE 識別が有効になる。
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

alter table enger.candidates add column if not exists signup_source text;
alter table enger.jobs       add column if not exists signup_source text;

-- 絞り込み高速化（任意）。LINE 行は少数想定だが、増えても効くように部分インデックスを張る。
create index if not exists candidates_signup_source_idx on enger.candidates (signup_source) where signup_source is not null;
create index if not exists jobs_signup_source_idx       on enger.jobs       (signup_source)       where signup_source is not null;

comment on column enger.candidates.signup_source is '登録経路。line=LINE経由で登録。LINE登録タブ(/line)の判別に使用。';
comment on column enger.jobs.signup_source       is '登録経路。line=LINE経由で登録。LINE登録タブ(/line)の判別に使用。';
