-- Gmail 自動取込（GAS 代替）に必要なテーブル＆カラム。
--   ※ enger スキーマは schema-matching.sql で作成済みであること。
--   このファイルは単体で実行可能（ベーステーブルが無ければ作成し、カラムを追加する）。

-- ── ベーステーブル（inbox-emails.sql 未適用でも動くよう IF NOT EXISTS で作成）──
create table if not exists enger.inbox_emails (
  id                    uuid primary key default gen_random_uuid(),
  gmail_message_id      text not null unique,
  gmail_thread_id       text,
  subject               text,
  from_email            text,
  from_name             text,
  to_email              text,
  body                  text,
  body_html             text,
  has_attachment        boolean default false,
  attachment_names      text[],
  received_at           timestamptz,
  synced_at             timestamptz not null default now(),

  extracted_at          timestamptz,
  extracted_kind        text,
  extracted_data        jsonb,
  extracted_summary     text,

  registered_at         timestamptz,
  registered_job_no     int,
  registered_candidate_no int,
  registered_by_email   text,
  skipped_reason        text,

  is_archived           boolean default false
);

create index if not exists inbox_emails_received_idx on enger.inbox_emails (received_at desc);
create index if not exists inbox_emails_status_idx on enger.inbox_emails (extracted_at, is_archived);

alter table enger.inbox_emails enable row level security;
grant select on enger.inbox_emails to anon, authenticated;
grant all on enger.inbox_emails to service_role;

-- ── 自動取込で追加するカラム ──
--   confidence: AI が返した自信度（0.0〜1.0）。閾値以上のみ自動登録。
--   auto_registered: 人ではなく cron/AI が自動登録したフラグ（運用検証用）。
alter table enger.inbox_emails
  add column if not exists confidence numeric,
  add column if not exists auto_registered boolean default false;

create index if not exists inbox_emails_confidence_idx on enger.inbox_emails (confidence);

comment on column enger.inbox_emails.confidence is 'AI 抽出時の自信度 0.0〜1.0。0.75 以上で自動登録。';
comment on column enger.inbox_emails.auto_registered is 'cron による自動登録か（true=AI判断・false=人が承認）。';
