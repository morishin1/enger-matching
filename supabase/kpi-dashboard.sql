-- KPI ダッシュボード用テーブル。
--   ・proposals に「業務カテゴリ」(SES/受託/EC)を追加（PC=受託・N=EC を数えるため）
--   ・kpi_targets: 個人/チームの週次目標を保存（他期間は週次から自動換算）
--
-- ※ 既に存在する列やテーブルは IF NOT EXISTS で安全に再実行可能。

-- ── 業務カテゴリ ───────────────────────────────────────────
alter table enger.proposals
  add column if not exists business_category text;
-- 値: 'SES' | '受託' | 'EC' | null
comment on column enger.proposals.business_category is 'KPI集計用の業務カテゴリ: SES/受託/EC';
create index if not exists proposals_business_category_idx on enger.proposals (business_category);

-- ── KPI 目標 ─────────────────────────────────────────────
create table if not exists enger.kpi_targets (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,                       -- 'person' | 'team'
  owner_email text,                                -- scope='person' のとき必須
  owner_name  text,                                -- 表示用（staff.name と一致）
  team_key    text,                                -- scope='team' のとき必須（例: 'its'）
  week_start  date not null,                       -- 当該週の月曜（JST）
  metric      text not null,                       -- 'proposal' | 'cl' | 'won' | 'lost' | 'taku' | 'ec' | 'meeting'
  target      int  not null check (target >= 0),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 1 週・1 指標・1 対象につき1行
create unique index if not exists kpi_targets_unique_idx
  on enger.kpi_targets (
    scope,
    coalesce(owner_email, ''),
    coalesce(team_key, ''),
    week_start,
    metric
  );

create index if not exists kpi_targets_week_idx on enger.kpi_targets (week_start);
create index if not exists kpi_targets_owner_idx on enger.kpi_targets (owner_email);

alter table enger.kpi_targets enable row level security;
grant select on enger.kpi_targets to anon, authenticated;
grant all on enger.kpi_targets to service_role;

comment on table  enger.kpi_targets is 'KPI 週次目標。日/月/四半期は週次から換算して表示。';
comment on column enger.kpi_targets.metric is '指標キー: proposal/cl/won/lost/taku(=PC)/ec(=N)/meeting';
