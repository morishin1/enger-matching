-- 打ち合わせ記録に「仕入れKGI」を追加：その打ち合わせで案件情報・人材情報を
-- どれだけ獲得できたか（＝質の良い案件/人材情報がもらえているか）を記録する。
--   ・job_info_count  … この打ち合わせで得た「案件情報」の件数
--   ・cand_info_count … この打ち合わせで得た「人材情報」の件数
-- KGI（獲得率）は「情報を1件以上得られた打ち合わせ ÷ 打ち合わせ数」で算出（集計側）。
alter table enger.meetings add column if not exists job_info_count  int not null default 0;
alter table enger.meetings add column if not exists cand_info_count int not null default 0;

comment on column enger.meetings.job_info_count  is 'この打ち合わせで獲得した案件情報の件数（仕入れKGI）';
comment on column enger.meetings.cand_info_count is 'この打ち合わせで獲得した人材情報の件数（仕入れKGI）';
