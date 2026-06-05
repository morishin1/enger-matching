-- チーム（部署）KGI 目標保存テーブル。
--   ・室山チーム等のマネージャー単位の月次KGI（粗利・稼働数・離脱数）を保存
--   ・スコープは「部署＝チーム」（DEPARTMENTS の値をそのまま department に保存）
--   ・metric: gross_profit_man（月間粗利・万円） / active_engineers（月末稼働中エンジニア累計） / dropout（月内離脱）
--   ・目標は「下限〜上限」のレンジを許容（単一値の場合は target_min = target_max）
--
-- ※ 既に存在する場合は安全に再実行可（IF NOT EXISTS）。

create table if not exists enger.team_kgi (
  id               uuid primary key default gen_random_uuid(),
  department       text not null,                  -- 部署＝チーム（DEPARTMENTS の値）
  month            date not null,                  -- 月初日（例: 2026-06-01）
  metric           text not null,                  -- 'gross_profit_man' | 'active_engineers' | 'dropout'
  target_min       numeric,                        -- 下限目標（必須・単一値の場合は max と同値）
  target_max       numeric,                        -- 上限目標（任意）
  note             text,                           -- メモ
  updated_by_email text,
  updated_by_name  text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 1 部署・1 月・1 指標につき1行
create unique index if not exists team_kgi_unique_idx
  on enger.team_kgi (department, month, metric);

create index if not exists team_kgi_dept_month_idx on enger.team_kgi (department, month);

alter table enger.team_kgi enable row level security;
grant select on enger.team_kgi to anon, authenticated;
grant all on enger.team_kgi to service_role;

comment on table  enger.team_kgi is 'チーム（部署）月次KGI目標。粗利・稼働数・離脱数のレンジ目標。';
comment on column enger.team_kgi.metric is '指標キー: gross_profit_man(月間粗利・万円) / active_engineers(月末稼働中累計) / dropout(月内離脱)';
