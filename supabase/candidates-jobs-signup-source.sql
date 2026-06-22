-- 人材(candidates)・案件(jobs) に「登録経路」列を追加。
--   ・LINE 経由で新規登録したものを LINE登録（signup_source='line'）として識別する。
--   ・LINE登録タブ(/line) は proposals.source='line' に加え、ここの signup_source='line' も拾う。
--   ・未適用でもアプリは fail-soft で動く（この列を外して登録する）。適用すると LINE 識別が有効になる。

alter table if exists public.candidates add column if not exists signup_source text;
alter table if exists public.jobs       add column if not exists signup_source text;

-- 絞り込み高速化（任意）。LINE 行は少数想定だが、増えても効くように部分インデックスを張る。
create index if not exists candidates_signup_source_idx on public.candidates (signup_source) where signup_source is not null;
create index if not exists jobs_signup_source_idx       on public.jobs (signup_source)       where signup_source is not null;
