-- タイムカード（バイト/副業向け）
--   ・本人が日ごとに予定登録・出勤/退勤打刻
--   ・月締めで申請（status: open → submitted）
--   ・マネージャー/admin が月単位で承認（submitted → approved/rejected）
--
--   1人 × 1日 = 1エントリ（UNIQUE）。予定だけの日・実績だけの日・両方ある日のいずれも許容。
--   labor_minutes は (actual_end - actual_start) - break_minutes をアプリ側で算出するため列を持たず、
--   表示・集計時に計算する（DB側の整合性問題を避け、後からの仕様変更に強くする）。

alter table enger.app_users
  add column if not exists is_timecard_user boolean default false;

comment on column enger.app_users.is_timecard_user
  is 'タイムカードの本人入力対象（バイト/副業向け）。マネージャー/adminは承認のためフラグ無関係で操作可。';

create table if not exists enger.time_entries (
  id              uuid primary key default gen_random_uuid(),
  user_email      text not null,                      -- app_users.email を参照（外部キーは張らずソフト紐付け）
  user_name       text,                               -- 表示用キャッシュ（差し戻し通知などで使う）
  department      text,                               -- 承認スコープ用キャッシュ（マネージャー= 自部署のみ承認可）
  work_date       date not null,                      -- 何の日の勤務か（タイムゾーンずれを避けるためアプリ側で JST に正規化）
  planned_start   timestamptz,                        -- 予定開始（任意）
  planned_end     timestamptz,                        -- 予定終了（任意）
  actual_start    timestamptz,                        -- 実績 開始
  actual_end      timestamptz,                        -- 実績 終了
  break_minutes   int not null default 0,             -- 休憩（分）
  note            text,
  status          text not null default 'open'
                  check (status in ('open','submitted','approved','rejected')),
  approver_email  text,
  approver_name   text,
  approved_at     timestamptz,
  reject_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_email, work_date)
);

create index if not exists time_entries_user_month_idx on enger.time_entries (user_email, work_date desc);
create index if not exists time_entries_status_idx     on enger.time_entries (status);
create index if not exists time_entries_dept_status_idx on enger.time_entries (department, status);

comment on table enger.time_entries is 'タイムカード（社内バイト/副業向け）。1人1日1行、status で承認状況を管理。';
