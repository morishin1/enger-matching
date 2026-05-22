-- ============================================================
-- enger.candidates に ランク (A/B/C) 列を追加 (冪等)
--   中央 Supabase の SQL Editor で実行。
--   案件(jobs)と同様に人材一覧でランクを表示・絞り込みできるようにする。
-- ============================================================

alter table enger.candidates add column if not exists rank text;  -- 'A' / 'B' / 'C' / null

-- 任意: スキルレベルから初期ランクを推定して埋める（既存が null の行のみ）
-- update enger.candidates
--   set rank = case
--     when skill_level ilike '%上級%' or skill_level ilike '%expert%' then 'A'
--     when skill_level ilike '%中級%' then 'B'
--     when skill_level ilike '%初級%' then 'C'
--     else rank end
--   where rank is null;

-- 確認
-- select rank, count(*) from enger.candidates group by rank;
