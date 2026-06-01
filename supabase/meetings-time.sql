-- 打ち合わせの時刻列。日付(meeting_date)とは別に持ち、カレンダー表示・並び順に活用。
-- 既存データ NULL は時刻未設定として扱う。
alter table enger.meetings add column if not exists meeting_time time;
