-- ============================================================
-- 企業管理: 案件(jobs) × 提案(proposals) × 打合せ(meetings) を企業名で統合集約。
--   「どの企業を狙うべきか」を判断する材料(供給力/実績/温度感/関係性)を返す。
--   中央 Supabase の SQL Editor で実行。
--   ※ proposals / meetings テーブルが必要(schema-matching.sql / meetings.sql)。
-- ============================================================

create or replace function enger.company_overview()
returns json
language sql
stable
as $$
  select coalesce(json_agg(row_to_json(c) order by c.active_jobs desc, c.job_count desc), '[]'::json)
  from (
    select
      g.name, g.job_count, g.active_jobs, g.focus_jobs, g.last_job_at, g.avg_rate,
      case when g.job_count >= 10 then 'A' when g.job_count >= 3 then 'B' else 'C' end as tier,
      case
        when g.last_job_at < now() - interval '90 days' then '休眠'
        when g.job_count >= 10 then '主要'
        when g.job_count <= 2 then '新規'
        else '拡大中'
      end as status,
      coalesce(pr.proposals_total, 0) as proposals_total,
      coalesce(pr.won, 0) as won,
      coalesce(pr.lost, 0) as lost,
      lm.fb_sentiment   as last_sentiment,
      lm.relation_status as last_relation,
      lm.meeting_date   as last_meeting_at,
      coalesce(mc.meeting_count, 0) as meeting_count
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
    left join (
      select company,
        count(*) as proposals_total,
        count(*) filter (where stage = '稼働決定') as won,
        count(*) filter (where stage in ('見送り','失注')) as lost
      from enger.proposals where company is not null group by company
    ) pr on pr.company = g.name
    left join (
      select company_name, count(*) as meeting_count from enger.meetings group by company_name
    ) mc on mc.company_name = g.name
    left join lateral (
      select fb_sentiment, relation_status, meeting_date
      from enger.meetings m where m.company_name = g.name
      order by meeting_date desc nulls last, created_at desc
      limit 1
    ) lm on true
  ) c;
$$;

grant execute on function enger.company_overview() to anon, authenticated, service_role;

-- 確認
-- select json_array_length(enger.company_overview());
