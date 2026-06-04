-- /api/cron/auto-ingest（GAS 代替の完全自動取込）用カラム。
--   confidence: AI が返した自信度（0.0〜1.0）。閾値以上のみ自動登録。
--   auto_registered: 人ではなく cron/AI が自動登録したフラグ（運用検証用）。

alter table enger.inbox_emails
  add column if not exists confidence numeric,
  add column if not exists auto_registered boolean default false;

create index if not exists inbox_emails_confidence_idx on enger.inbox_emails (confidence);

comment on column enger.inbox_emails.confidence is 'AI 抽出時の自信度 0.0〜1.0。0.75 以上で自動登録。';
comment on column enger.inbox_emails.auto_registered is 'cron による自動登録か（true=AI判断・false=人が承認）。';
