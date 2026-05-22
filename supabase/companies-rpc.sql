-- ============================================================
-- 企業管理: 実在する案件(enger.jobs)のクライアント名から企業を集約。
--   enger.companies テーブルが空でも、案件データから企業一覧を生成する。
--   中央 Supabase の SQL Editor で実行。anon から呼べるよう grant。
-- ============================================================

create or replace function enger.company_overview()
returns json
language sql
stable
as $$
  select coalesce(json_agg(row_to_json(c) order by c.active_jobs desc, c.job_count desc), '[]'::json)
  from (
    select
      g.name,
      g.job_count,
      g.active_jobs,
      g.focus_jobs,
      g.last_job_at,
      g.avg_rate,
      -- 取引規模からティアを推定 (案件数ベース)
      case when g.job_count >= 10 then 'A' when g.job_count >= 3 then 'B' else 'C' end as tier,
      -- ステータス: 90日超で休眠 / 多案件は主要 / 少数は新規 / それ以外拡大中
      case
        when g.last_job_at < now() - interval '90 days' then '休眠'
        when g.job_count >= 10 then '主要'
        when g.job_count <= 2 then '新規'
        else '拡大中'
      end as status
    from (
      select
        j.client_name as name,
        count(*) as job_count,
        count(*) filter (where coalesce(j.status,'募集中') = '募集中') as active_jobs,
        count(*) filter (where j.is_focus) as focus_jobs,
        max(j.created_at) as last_job_at,
        round(avg(coalesce(j.salary_max, j.salary_min)))::int as avg_rate
      from enger.jobs j
      where j.is_published and j.client_name is not null and btrim(j.client_name) <> ''
      group by j.client_name
    ) g
  ) c;
$$;

grant execute on function enger.company_overview() to anon, authenticated, service_role;

-- 確認
-- select json_array_length(enger.company_overview());
