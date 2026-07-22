-- X集客PR：Slack配信（/api/cron/x-posts）で提示した案件の履歴。
--   直近に提示した案件を候補から外し、同じ案件が何度も配信されるのを防ぐ（ローテーション）。
--   このテーブルが無くても配信自体は動く（ローテーションだけ無効になる・fail-soft）。
-- 適用：Supabase SQL Editor で本ファイルを実行。

create table if not exists enger.pr_featured_jobs (
  id bigint generated always as identity primary key,
  job_no integer not null,
  slot text,
  featured_at timestamptz not null default now()
);

create index if not exists pr_featured_jobs_featured_at_idx
  on enger.pr_featured_jobs (featured_at desc);
create index if not exists pr_featured_jobs_job_no_idx
  on enger.pr_featured_jobs (job_no);
