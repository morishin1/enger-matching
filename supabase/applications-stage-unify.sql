-- ============================================================
-- 応募(applications)の status / stage 統合（冪等）
--   dx 側は stage 一本化。status は LP 互換のため当面残置（将来 drop）。
--   stage が初期値 '応募' のまま status が先に進んでいるレコードに stage を反映。
-- ============================================================

update enger.applications
   set stage = case status
     when 'reviewing' then '書類選考'
     when 'passed'    then '面談合格'
     when 'rejected'  then '見送り'
     else stage end,
       stage_updated_at = coalesce(stage_updated_at, now())
 where stage = '応募' and status in ('reviewing','passed','rejected');

-- 確認用
-- select stage, status, count(*)
--   from enger.applications
--   group by stage, status
--   order by 1, 2;
