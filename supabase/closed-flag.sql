-- ============================================================
-- クローズ済フラグ (is_closed) を案件・人材に追加 (冪等)
--   募集終了/成約済などで運用から外したい案件・人材を「クローズ」する。
--     ・false = 通常（一覧・マッチング対象）
--     ・true  = クローズ済（一覧の初期表示からは除外。検索ヒット時のみ表示。
--               マッチングボタンは出さない。提案管理では「クローズ済」と表記）
--   ※ ゴミ箱(deleted_at)とは別概念：履歴・検索には残したいが運用導線からは外す。
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

alter table enger.jobs       add column if not exists is_closed boolean not null default false;
alter table enger.candidates add column if not exists is_closed boolean not null default false;

-- 通常一覧は is_closed = false で絞る。partial index で高速化。
create index if not exists jobs_open_idx       on enger.jobs       (job_no desc)       where is_closed = false;
create index if not exists candidates_open_idx on enger.candidates (candidate_no desc) where is_closed = false;

comment on column enger.jobs.is_closed       is 'クローズ済。false=通常、true=運用から外す（一覧初期表示から除外・検索では表示）。';
comment on column enger.candidates.is_closed is 'クローズ済。false=通常、true=運用から外す（一覧初期表示から除外・検索では表示）。';

-- anon は更新不可（読み取りのみ）。クローズ操作はアプリの service role 経由で行う。
