-- ============================================================
-- ai_usage に provider 列を追加（Gemini/GAS 等の外部AIコストも同じ表で集計）
--   既存行は内蔵AI(Anthropic)とみなすため default 'internal'
-- ============================================================

alter table enger.ai_usage add column if not exists provider text default 'internal';

-- 外部AI(Gemini)の記録は /api/usage 経由で provider='google' で入ります。
-- 確認:
-- select provider, count(*), round(sum(cost_usd)::numeric, 4) as usd
-- from enger.ai_usage
-- where created_at >= date_trunc('month', now())
-- group by provider;
