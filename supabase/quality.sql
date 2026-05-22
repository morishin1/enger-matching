-- ============================================================
-- データ品質ゲート / KPI母数の分離 (冪等)
--   ・接触前失注/NGを母数から外し「接触後失注率」を主指標にする
--   ・品質ルール(1週間返信なし/見込み薄/重複)を定義し、適用で disqualified を立てる
-- ============================================================

-- 提案のNG除外フラグ
alter table enger.proposals add column if not exists disqualified boolean not null default false;
alter table enger.proposals add column if not exists dq_reason    text;
alter table enger.proposals add column if not exists dq_at        timestamptz;
create index if not exists proposals_dq_idx on enger.proposals (disqualified);

-- 品質ルール定義
create table if not exists enger.quality_rules (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,                 -- 'no_reply' | 'low_potential' | 'duplicate'
  label      text not null,
  enabled    boolean not null default true,
  threshold  numeric,                       -- no_reply=日数 / low_potential=スコア下限
  note       text,
  sort       int default 0,
  created_at timestamptz not null default now()
);

alter table enger.quality_rules enable row level security;
grant all on enger.quality_rules to service_role;
grant select on enger.quality_rules to anon, authenticated;
drop policy if exists quality_rules_read on enger.quality_rules;
create policy quality_rules_read on enger.quality_rules for select using (true);

-- 初期ルール（重複は無視）
insert into enger.quality_rules (kind, label, enabled, threshold, note, sort) values
  ('no_reply',      '1週間返信なし',     true, 7,  '提案/未対応のまま、接触できず日数が経過', 1),
  ('low_potential', '見込み薄(スコア低)', true, 40, 'マッチ度がしきい値未満', 2),
  ('duplicate',     '重複提案',          true, null, '同一企業×案件で重複した提案の2件目以降', 3)
on conflict do nothing;

-- 確認
-- select kind, label, enabled, threshold from enger.quality_rules order by sort;
-- select disqualified, dq_reason, count(*) from enger.proposals group by 1,2;
