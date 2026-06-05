-- 個人月次KGI。マネージャーが部下と1on1で決める「今月の稼働化目標」を保存。
--   ・スコープは「個人 × 月」
--   ・中核指標は稼働化件数（提案者+クロージング担当の合計）
--   ・転換率はファネルから算出し、これを月→週→日に按分して個人KPIに展開する
--
-- ※ 既存の team_kgi（部署×月）と組み合わせて、管理者→部署、マネージャー→個人 の2階層で運用する。

create table if not exists enger.person_kgi (
  id                  uuid primary key default gen_random_uuid(),
  owner_email         text not null,                 -- 対象メンバーのメール（accounts.email と一致）
  owner_name          text,                          -- 表示用（accounts.name）
  department          text,                          -- 設定時点の部署（履歴目的）
  month               date not null,                 -- 月初（YYYY-MM-01）
  placement_target    numeric,                       -- 今月の稼働化目標（件数・提案者+クロージング合計）
  note                text,
  updated_by_email    text,                          -- 設定者（マネージャー or 管理者）
  updated_by_name     text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (owner_email, month)
);

create index if not exists person_kgi_month_idx on enger.person_kgi (month);
create index if not exists person_kgi_owner_idx on enger.person_kgi (owner_email);

alter table enger.person_kgi enable row level security;
grant select on enger.person_kgi to anon, authenticated;
grant all on enger.person_kgi to service_role;

comment on table  enger.person_kgi is '個人の月次KGI（稼働化目標件数）。マネージャー/管理者が設定。';
comment on column enger.person_kgi.placement_target is '月内に到達したい稼働化件数（提案者+クロージング担当の合計）';
