-- チーム（部署）KGI 目標保存テーブル（稼働数ドリブン版）。
--   ・KGIの中心は「稼働数」：今の稼働(active_current)から何人増やすか(active_add)
--   ・売上・利益はそれに紐づけて自動算出（目標稼働数 × 1名あたり平均月額／粗利）
--   ・スコープは「部署＝チーム」（DEPARTMENTS の値を department に保存）
--   ・1 部署・1 月につき1行（ワイド構成）
--
-- ※ 旧バージョン（metric 行持ち）からスキーマを変更したため、作り替える。
--   この機能は新規のため実データはほぼ無い想定。安全に再実行できるよう drop して作り直す。

drop table if exists enger.team_kgi cascade;

create table enger.team_kgi (
  id                 uuid primary key default gen_random_uuid(),
  department         text not null,                 -- 部署＝チーム（DEPARTMENTS の値）
  month              date not null,                 -- 月初日（例: 2026-06-01）
  active_current     numeric,                        -- 現在の稼働数（基準）
  active_add         numeric,                        -- 今月増やす目標（人数）
  rate_per_head_man  numeric,                        -- 1名あたり平均月額売上（万円）
  gross_per_head_man numeric,                        -- 1名あたり平均月額粗利（万円）
  dropout_allowed    numeric,                        -- 許容離脱数（目標は0）
  note               text,
  updated_by_email   text,
  updated_by_name    text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (department, month)
);

create index if not exists team_kgi_dept_month_idx on enger.team_kgi (department, month);

alter table enger.team_kgi enable row level security;
grant select on enger.team_kgi to anon, authenticated;
grant all on enger.team_kgi to service_role;

comment on table  enger.team_kgi is 'チーム（部署）月次KGI。稼働数を起点に売上・利益を紐づける。';
comment on column enger.team_kgi.active_add is '今月増やす稼働数の目標（目標稼働数 = active_current + active_add）';
comment on column enger.team_kgi.rate_per_head_man is '1名あたり平均月額売上（万円）。売上見込み = 目標稼働数 × これ';
comment on column enger.team_kgi.gross_per_head_man is '1名あたり平均月額粗利（万円）。粗利見込み = 目標稼働数 × これ';
