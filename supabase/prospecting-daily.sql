-- ============================================================
-- エンド開拓：毎日追記（日次リスト）用の追加カラム
--   企業名,採用ページURL,企業URL,業種,所在地,ランク,シグナル,発見元,メモ の9列CSVを
--   そのまま取り込めるようにする。Supabase SQL Editor で何度実行しても安全な冪等SQL。
--   ※ supabase/prospecting.sql を先に実行しておくこと。
-- ============================================================

alter table enger.prospects add column if not exists career_url text;      -- 採用ページURL
alter table enger.prospects add column if not exists location text;        -- 所在地
alter table enger.prospects add column if not exists rank text;            -- A=今週送る / B=来週以降 / C=対象外
alter table enger.prospects add column if not exists signals text[] not null default '{}'; -- 資金調達 等
alter table enger.prospects add column if not exists found_via text;       -- 発見元（PR TIMES / Green / 企業HP など）

-- ランクは A/B/C のみ（既存行の null は許容）。制約は付け直しで冪等に。
alter table enger.prospects drop constraint if exists prospects_rank_check;
alter table enger.prospects add constraint prospects_rank_check
  check (rank is null or rank in ('A', 'B', 'C'));

-- 「今日の追記」「直近7日の推移」を出すための日付インデックスと、ドメイン重複チェック用。
create index if not exists prospects_created_at_idx on enger.prospects (created_at desc);
create index if not exists prospects_normalized_url_idx on enger.prospects (normalized_url);
create index if not exists prospects_rank_idx on enger.prospects (rank);

-- 確認
-- select jsonb_pretty(to_jsonb(p)) from enger.prospects p order by created_at desc limit 1;
-- select date(created_at at time zone 'Asia/Tokyo') as d, count(*)
--   from enger.prospects group by 1 order by 1 desc limit 14;
