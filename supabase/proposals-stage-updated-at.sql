-- ============================================================
-- 提案にステージ滞留時間を計算するための stage_updated_at 列を追加（冪等）
--   ステージが変わった瞬間を記録。提案カードで「ステージ滞留日数」を計算する。
--   未設定の既存行は updated_at（無ければ created_at）で初期化。
-- ============================================================

alter table enger.proposals
  add column if not exists stage_updated_at timestamptz;

-- バックフィル：updated_at or created_at で初期化
update enger.proposals
   set stage_updated_at = coalesce(stage_updated_at, updated_at, created_at)
 where stage_updated_at is null;

create index if not exists proposals_stage_updated_at_idx
  on enger.proposals (stage_updated_at);

-- 確認
-- select stage, count(*),
--        round(avg(extract(epoch from (now() - stage_updated_at))/86400)::numeric, 1) as avg_days
--   from enger.proposals
--   group by stage order by 1;
