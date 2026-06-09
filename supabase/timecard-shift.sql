-- タイムカード「シフト申請」拡張。
--   既存テーブル enger.time_entries に列を追加して、
--   ・シフト（予定 planned_start/end）自体の承認状態
--   ・シフト外で働いた理由
--   を保持できるようにする。既存行は shift_status = 'open' として扱う。
--
--   フロー：
--     1) 本人がシフト申請タブで planned_start/end を入力
--     2) 月単位で「シフトを申請」 → shift_status='submitted'
--     3) マネージャー/admin が承認 → shift_status='approved'。
--        承認後は本人は planned_start/end を編集不可（admin のみ差し戻し可）
--     4) 実績打刻が承認済シフトと異なる場合、edit modal で deviation_reason を必須化
--     5) 月締申請時、シフト外の日に deviation_reason が空ならエラー

alter table enger.time_entries
  add column if not exists shift_status         text default 'open'
    check (shift_status in ('open','submitted','approved','rejected')),
  add column if not exists shift_submitted_at   timestamptz,
  add column if not exists shift_approved_at    timestamptz,
  add column if not exists shift_approver_email text,
  add column if not exists shift_approver_name  text,
  add column if not exists shift_reject_reason  text,
  add column if not exists deviation_reason     text;

create index if not exists time_entries_shift_status_idx on enger.time_entries (shift_status);
create index if not exists time_entries_dept_shift_idx   on enger.time_entries (department, shift_status);

comment on column enger.time_entries.shift_status        is 'シフト（予定）の承認ステータス：open/submitted/approved/rejected';
comment on column enger.time_entries.shift_approved_at   is 'シフト承認日時';
comment on column enger.time_entries.shift_approver_email is 'シフトを承認したマネージャー/adminのメール';
comment on column enger.time_entries.shift_reject_reason is 'シフト差戻し理由';
comment on column enger.time_entries.deviation_reason    is '承認済シフト外で働いた理由（実績がシフトから外れた日に必須）';
