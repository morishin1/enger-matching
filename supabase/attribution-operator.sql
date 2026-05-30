-- 案件/人材の「登録担当」を記録する列。エージェント別の量KPI（誰が何件集めたか）の集計に使う。
-- 既存データは null（不明）のまま。今後の手動登録・CSV取込・メール一括取込で記録される。
alter table enger.candidates add column if not exists operator text;
alter table enger.jobs       add column if not exists operator text;
create index if not exists candidates_operator_idx on enger.candidates (operator, created_at);
create index if not exists jobs_operator_idx       on enger.jobs (operator, created_at);
