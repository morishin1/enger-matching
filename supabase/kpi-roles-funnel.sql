-- ============================================================
-- KPI推移：メンバーの役割(アウトサイド/インサイド/テレアポ) と チームファネル目標（冪等）
--   ・app_users.kpi_role : メンバーの役割。当日KPIボードの役割別グルーピングに使う。
--       'outside'=アウトサイド / 'inside'=インサイド / 'telapo'=テレアポ
--   ・kpi_funnel_target  : チームのファネル目標（稼働数・面談率・合格率）。1行のみ(id=1)。
--       提案=面談/面談率, 面談=稼働/合格率 で逆算表示する。マネージャー以上が設定。
-- ============================================================
alter table enger.app_users
  add column if not exists kpi_role text;  -- outside / inside / telapo

create table if not exists enger.kpi_funnel_target (
  id           int primary key default 1,
  won_target   numeric not null default 4,     -- 月の稼働目標（KGI）
  meeting_rate numeric not null default 0.20,  -- 面談率（提案→面談）
  pass_rate    numeric not null default 0.33,  -- 合格率（面談→稼働）
  updated_by   text,
  updated_at   timestamptz not null default now(),
  constraint kpi_funnel_target_singleton check (id = 1)
);

-- 既定の1行を用意（無ければ）。
insert into enger.kpi_funnel_target (id) values (1) on conflict (id) do nothing;

comment on column enger.app_users.kpi_role is 'KPI役割: outside=アウトサイド / inside=インサイド / telapo=テレアポ';
