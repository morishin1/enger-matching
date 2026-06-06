-- バウンス（送達不能）アドレス記録。
--   送信した提案メール等が宛先に届かず mailer-daemon から不達通知が返ってきた場合に、
--   その対象メールアドレスを蓄積してマッチング/提案画面で警告に使う。
--   入口：syncInboxFromGmail / processInboxBounces で本文を解析して recipient を抽出。

create table if not exists enger.bounce_records (
  id                uuid primary key default gen_random_uuid(),
  recipient_email   text not null,
  bounce_count      int  not null default 1,
  first_bounced_at  timestamptz not null default now(),
  last_bounced_at   timestamptz not null default now(),
  last_subject      text,                      -- 不達通知の件名（ex: Delivery Status Notification (Failure)）
  last_reason       text,                      -- 抽出した SMTP 失敗理由・抜粋
  sample_message_id text,                      -- 参考に開ける Gmail message id
  unique (recipient_email)
);

create index if not exists bounce_records_last_idx on enger.bounce_records (last_bounced_at desc);

comment on table  enger.bounce_records is '送達不能メールアドレスの蓄積（提案メール等の不達検知用）';
comment on column enger.bounce_records.bounce_count is 'これまでに観測した不達回数';
