-- ============================================================
-- 承認フローとメール送信履歴／打合せ記録の連動
--   1) account_emails: 承認待ちユーザーに送ったメール（テンプレ・本文・宛先・誰が送ったか）
--   2) meetings.account_id: 打合せ記録をアカウントに紐づけ（承認フロー = 面談実施 → 承認）
-- ============================================================

create table if not exists enger.account_emails (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid,                 -- enger.app_users.id（承認対象）
  account_email text,                 -- 宛先
  template      text,                 -- 'welcome' | 'meeting_request' | 'approved' | 'rejected' | 'reminder' | 'custom'
  subject       text not null,
  body          text not null,
  actor_email   text,                 -- 送信操作者
  actor_name    text,
  status        text not null default 'sent',  -- 'sent' | 'draft'（運用上は sent のみで可）
  created_at    timestamptz not null default now()
);
create index if not exists account_emails_account_idx on enger.account_emails (account_id, created_at desc);
create index if not exists account_emails_template_idx on enger.account_emails (template);

-- 打合せ記録をアカウントに紐づける列（承認フロー連動）。既存運用は company_name でも検索可。
alter table enger.meetings add column if not exists account_id    uuid;
alter table enger.meetings add column if not exists account_email text;
create index if not exists meetings_account_idx on enger.meetings (account_id, meeting_date desc);
