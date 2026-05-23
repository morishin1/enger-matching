-- ============================================================
-- 請求・勤怠タスク  enger.billing_tasks （バックオフィス）
--   稼働(engagement) × 月(period) ごとに「勤怠チェック」「請求書発行」を管理。
--   両方 完了でタスクが消える運用。ファイルは Supabase Storage に保存。
-- ============================================================

create table if not exists enger.billing_tasks (
  id                uuid primary key default gen_random_uuid(),
  engagement_id     uuid references enger.engagements(id) on delete cascade,
  period            text not null,                 -- 'YYYY-MM'
  attendance_status text default '未',             -- 未 / 確認済
  attendance_hours  numeric,                        -- 勤怠（当月稼働時間）
  attendance_file   text,                           -- Storage パス/URL
  invoice_status    text default '未',             -- 未 / 発行済
  invoice_amount    numeric,                        -- 請求額(万 or 円, 入力に合わせる)
  invoice_file      text,                           -- Storage パス/URL
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists billing_tasks_uniq on enger.billing_tasks (engagement_id, period);
create index if not exists billing_tasks_period_idx on enger.billing_tasks (period);

alter table enger.billing_tasks enable row level security;
grant all on enger.billing_tasks to service_role;

-- ★ Storage バケットを作成してください（Supabase ダッシュボード → Storage → New bucket）：
--    名前: billing   /   Public: ON（簡易運用）
-- 機密文書のため本番では署名付きURL運用を推奨しますが、まずは public で動作します。

-- 確認
-- select e.candidate_name, b.period, b.attendance_status, b.invoice_status, b.invoice_amount
--   from enger.billing_tasks b join enger.engagements e on e.id = b.engagement_id
--  order by b.period desc;
