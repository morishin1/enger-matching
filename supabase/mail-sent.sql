-- 送信したメールの記録。誰がいつ どの差出人で 誰に 何を送ったかを残す（監査・重複防止）。
create table if not exists enger.mail_sent (
  id              uuid primary key default gen_random_uuid(),
  sender_key      text not null,          -- 'enger' / '8grp'（差出人プロファイル）
  from_address    text not null,          -- 実際の送信元アドレス
  to_address      text not null,
  cc_address      text,
  bcc_address     text,
  subject         text not null,
  body            text,
  message_id      text,                   -- SMTP が返した Message-ID
  sent_by_email   text,                   -- 送信操作した社内ユーザー
  sent_by_name    text,
  related_kind    text,                   -- 'proposal' / 'candidate' / 'job' / 'inquiry' など（任意）
  related_id      text,                   -- 関連レコードID（任意）
  created_at      timestamptz not null default now()
);
create index if not exists mail_sent_created_idx on enger.mail_sent (created_at desc);
create index if not exists mail_sent_related_idx on enger.mail_sent (related_kind, related_id);

alter table enger.mail_sent enable row level security;
grant select on enger.mail_sent to anon, authenticated;
grant all on enger.mail_sent to service_role;

comment on table enger.mail_sent is 'ENGER から送信したメールの記録（差出人ドメイン別・監査用）。';
