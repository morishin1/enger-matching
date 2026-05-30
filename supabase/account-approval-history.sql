-- アカウント承認の履歴：誰が承認・面談済みにしたかを残す。
--   既存の approved_at に加え approved_by_email / approved_by_name を保存。
--   meeting_done についても同様に *_by_email / *_by_name を保存。
alter table enger.app_users add column if not exists approved_by_email      text;
alter table enger.app_users add column if not exists approved_by_name       text;
alter table enger.app_users add column if not exists meeting_done_by_email  text;
alter table enger.app_users add column if not exists meeting_done_by_name   text;

-- 監査ログ：細かい操作履歴（誰が・いつ・何を）。表示は最近のもの上位N件で十分。
create table if not exists enger.account_audits (
  id            uuid primary key default gen_random_uuid(),
  target_id     uuid,                 -- 操作対象アカウント
  target_email  text,
  action        text not null,        -- 'approve' | 'meeting_done_on' | 'meeting_done_off' | 'status_disabled' | 'status_active' | 'role_change' | 'create_agent'
  detail        text,                 -- 補足（変更後のロール等）
  actor_email   text,                 -- 操作者
  actor_name    text,
  actor_role    text,                 -- 操作者のロール（admin/agent）
  created_at    timestamptz not null default now()
);
create index if not exists account_audits_target_idx on enger.account_audits (target_id, created_at desc);
create index if not exists account_audits_actor_idx  on enger.account_audits (actor_email, created_at desc);
