-- 提案の承認フロー（承認依頼→承認/差戻し→送信）に必要な列・テーブルをまとめて整備する。
--   これらが未適用だと createProposal が承認列を落として "所属確認" で作成してしまい、
--   「承認待ちにならない／承認フォルダに出ない／承認依頼通知が届かない」状態になる。
--   すべて idempotent（IF NOT EXISTS）なので、既に適用済みの環境で再実行しても安全。

-- ① 承認チェック列（提案者＋承認者・承認状態・差戻し理由）
alter table enger.proposals
  add column if not exists approver        text,
  add column if not exists approval_status text,
  add column if not exists approved_at     timestamptz,
  add column if not exists approver_email  text,
  add column if not exists reject_reason   text;

-- 既存レコードは「承認済」として扱う（NULL のままだと UI で「承認待ち」と誤判定するため）。
update enger.proposals set approval_status = 'approved'
  where approval_status is null and stage <> '承認待ち';

create index if not exists proposals_approval_pending_idx
  on enger.proposals (created_at desc) where approval_status = 'pending';

-- ② 承認者が送信するためのメール下書き＋送信記録
alter table enger.proposals
  add column if not exists pending_mail   jsonb,
  add column if not exists mail_sent_at   timestamptz,
  add column if not exists mail_sent_by   text;

create index if not exists proposals_mail_pending_idx
  on enger.proposals ((pending_mail is not null)) where pending_mail is not null;

-- ③ お知らせ（承認依頼・承認結果の通知先）。recipient は受信者の氏名（'all' で全員）。
create table if not exists enger.notifications (
  id         uuid primary key default gen_random_uuid(),
  recipient  text not null,
  title      text not null,
  body       text,
  kind       text default 'feedback',
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists notifications_recipient_idx
  on enger.notifications (recipient, created_at desc);

alter table enger.notifications enable row level security;
grant all on enger.notifications to service_role;
grant select on enger.notifications to anon, authenticated;
drop policy if exists notifications_read on enger.notifications;
create policy notifications_read on enger.notifications for select using (true);
