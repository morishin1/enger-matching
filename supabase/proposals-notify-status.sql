-- 提案の「通知ステータス」（案件側 / 人材側で個別に追跡）。
-- 例：提案後はクライアント案件側にアクションが必要 → job_notify_status='pending' で赤く点滅
--     候補者の意思確認が必要なときは cand_notify_status='pending'
--     値: 'pending'(未処理・赤) / 'in_progress'(処理中・青) / 'done'(完了・無し)
alter table enger.proposals add column if not exists job_notify_status  text default 'pending';
alter table enger.proposals add column if not exists cand_notify_status text default 'pending';

comment on column enger.proposals.job_notify_status  is '案件側の通知ステータス：pending(未処理)/in_progress(処理中)/done(完了)';
comment on column enger.proposals.cand_notify_status is '人材側の通知ステータス：pending(未処理)/in_progress(処理中)/done(完了)';

-- 新規 NULL レコード対策（既存データを pending に補正したい場合はコメントアウト解除）
-- update enger.proposals set job_notify_status='pending' where job_notify_status is null;
-- update enger.proposals set cand_notify_status='pending' where cand_notify_status is null;
