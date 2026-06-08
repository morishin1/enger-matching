-- 個人月次KGIを複数メトリクス対応にする拡張。
--   既存の placement_target（稼働化）は互換のため残し、targets.placement に同期する。
--   targets は { metricKey: number } 形式（例: {"placement":2,"proposal":20,"c:アポ獲得":6}）。
--
-- チーム目標（部署×月のKPI目標）は app_settings(key='team_kpi_goals') に保存するため、
-- ここでのテーブル追加は不要（supabase/app-settings.sql が前提）。

alter table enger.person_kgi
  add column if not exists targets jsonb not null default '{}'::jsonb;

comment on column enger.person_kgi.targets is
  '複数KPIの月次目標（{metricKey: number}）。placement は placement_target にミラー。';
