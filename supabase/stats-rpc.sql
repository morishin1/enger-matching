-- ============================================================
-- ダッシュボード集計関数 enger.matching_stats()
--   案件/人材ページの KPI を全件から正確に集計して 1 回で返す。
--   中央 Supabase の SQL Editor で実行。anon から呼べるよう grant。
-- ============================================================

create or replace function enger.matching_stats()
returns json
language sql
stable
as $$
  select json_build_object(
    -- ---- 案件 (jobs) ----
    'jobs_total',       (select count(*) from enger.jobs where is_published),
    -- 募集中 × スキル重複する人材が 1 名以上 = 実際に提案を出せる案件
    'jobs_proposable',  (select count(*) from enger.jobs j
                          where j.is_published
                            and coalesce(j.status,'募集中') = '募集中'
                            and array_length(j.skills,1) is not null
                            and exists (select 1 from enger.candidates c where c.skills && j.skills)),
    -- 直近7日の新規流入
    'jobs_new7',        (select count(*) from enger.jobs
                          where is_published and created_at >= now() - interval '7 days'),
    -- 要件詳細(リモート種別 + 業務内容/勤務地)まで入っている案件
    'jobs_detail_full', (select count(*) from enger.jobs
                          where is_published and remote_type is not null
                            and (detail is not null or work_location is not null)),

    -- ---- 人材 (candidates) ----
    'cand_total',        (select count(*) from enger.candidates),
    'cand_proposable',   (select count(*) from enger.candidates where status = '提案可'),
    'cand_skills',       (select count(*) from enger.candidates where array_length(skills,1) is not null),
    -- スキル + 希望単価が揃ったプロフィール充足
    'cand_profile_full', (select count(*) from enger.candidates
                           where array_length(skills,1) is not null
                             and (rate is not null or salary_min is not null)),
    -- 30日以上 情報更新なし = 鮮度切れ
    'cand_stale',        (select count(*) from enger.candidates
                           where coalesce(imported_at, created_at) < now() - interval '30 days'),
    -- 同名で複数登録 = 名寄せ候補(グループ数)
    'cand_dupes',        (select count(*) from
                           (select 1 from enger.candidates
                             where name is not null and btrim(name) <> ''
                             group by lower(btrim(name)) having count(*) > 1) t)
  );
$$;

grant execute on function enger.matching_stats() to anon, authenticated, service_role;

-- 確認
-- select enger.matching_stats();
