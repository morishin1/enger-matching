-- ============================================================
-- AI使用量ログ enger.ai_usage （設定ページでコストをグラフ表示）
-- ============================================================

create table if not exists enger.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  feature       text not null,            -- proposal / meeting / rerank
  model         text,
  input_tokens  int default 0,
  output_tokens int default 0,
  cost_usd      numeric default 0,        -- 概算
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on enger.ai_usage (created_at);

alter table enger.ai_usage enable row level security;
drop policy if exists ai_usage_read on enger.ai_usage;
create policy ai_usage_read on enger.ai_usage for select using (true);
grant select on enger.ai_usage to anon, authenticated;
grant all on enger.ai_usage to service_role;

-- 確認
-- select feature, count(*), round(sum(cost_usd)::numeric, 4) usd from enger.ai_usage group by feature;
