-- ============================================================
-- 打ち合わせ記録のフォロー管理 (冪等)
--   次回アクションに期限を持たせ、フォロー漏れを防ぐ。
-- ============================================================

alter table enger.meetings add column if not exists follow_up_date date;     -- 次回フォロー予定日
alter table enger.meetings add column if not exists follow_done    boolean not null default false;  -- フォロー完了

create index if not exists meetings_followup_idx on enger.meetings (follow_up_date) where follow_done = false;

-- 確認
-- select company_name, meeting_date, next_action_us, follow_up_date, follow_done from enger.meetings order by follow_up_date;
