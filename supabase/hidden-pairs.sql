-- #345①：マッチングで「このペアは表示させない」ペア（案件×人材）を保存する。
--   ここに入れた (job_no, candidate_no) の組み合わせは、期間に関係なく
--   おすすめ／ランキング100から恒久的に除外する（提案済みペア除外と同じ仕組み）。
--   一度非表示にしたペアを、別の担当が再度確認しなくてよくするための共有リスト。
--   冪等（何度実行しても安全）。Supabase の SQL Editor で実行してください。
create table if not exists enger.hidden_pairs (
  id uuid primary key default gen_random_uuid(),
  job_no integer not null,
  candidate_no integer not null,
  hidden_by_email text,
  hidden_by_name text,
  created_at timestamptz not null default now(),
  unique (job_no, candidate_no)
);
comment on table enger.hidden_pairs is 'マッチングで手動非表示にした案件×人材ペア（期間無関係にランキング除外）。#345';
