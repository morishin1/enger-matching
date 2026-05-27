-- ⑥ 提案ボードの二重登録を防止する一意制約。
--   症状：「提案ボードに記録」を押すと同じペア（案件×人材）が重複して並ぶ。
--   原因：重複チェックが多重ヒット時に誤判定して追加され続ける。
--   対策：既存の重複を1件に統合してから、(job_id, candidate_id) に一意制約を張る。

-- 1) 既存の重複を削除（各ペアで最も古い1件を残す）。
--    ※ 重複側に紐づく稼働(engagements)があれば、残す側へ付け替えてから消す。
with ranked as (
  select id, job_id, candidate_id,
         row_number() over (partition by job_id, candidate_id order by created_at asc, id asc) as rn,
         first_value(id) over (partition by job_id, candidate_id order by created_at asc, id asc) as keep_id
  from enger.proposals
)
update enger.engagements e
   set proposal_id = r.keep_id
  from ranked r
 where e.proposal_id = r.id and r.rn > 1;

delete from enger.proposals p
 using (
   select id from (
     select id, row_number() over (partition by job_id, candidate_id order by created_at asc, id asc) as rn
       from enger.proposals
   ) t where t.rn > 1
 ) dup
 where p.id = dup.id;

-- 2) 以後の重複を不可能にする一意制約。
create unique index if not exists proposals_job_cand_uq
  on enger.proposals (job_id, candidate_id);
