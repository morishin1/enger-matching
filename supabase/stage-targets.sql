-- ============================================================
-- 提案ステージ別の担当者目標 — enger.stage_targets
--   提案ボードの各ステージ（所属確認 / 提案中 / 確認中 / 面談 / 合格）について、
--   担当者(proposer 名)ごとの目標件数を保持する。KPI推移の「ステージ別 目標/現在/達成率」表示に使う。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.stage_targets (
  owner_name  text not null,                 -- 担当者名（proposals.proposer と同じ表記）
  stage       text not null,                 -- 所属確認 / 提案中 / 確認中 / 面談 / 合格
  target      integer not null default 0,    -- 目標件数
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (owner_name, stage)
);

alter table enger.stage_targets enable row level security;
drop policy if exists stage_targets_read on enger.stage_targets;
create policy stage_targets_read on enger.stage_targets for select using (true);
grant select on enger.stage_targets to anon, authenticated;
grant all on enger.stage_targets to service_role;

-- 確認
-- select owner_name, stage, target from enger.stage_targets order by owner_name, stage;
