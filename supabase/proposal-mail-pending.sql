-- 提案メールの下書きを承認者が送信する仕組みのため、
--   案件側・人材側のメール本文/件名/宛先を一旦 proposals に保存しておく。
--   承認者が「承認して送信」を押したタイミングで、ここから SMTP 送信する。
--   送信完了で mail_sent_at をセット。

alter table enger.proposals
  add column if not exists pending_mail   jsonb,                -- { job: {to,cc,subject,body}, cand: {to,cc,subject,body} }
  add column if not exists mail_sent_at   timestamptz,
  add column if not exists mail_sent_by   text;                 -- 承認者(送信実行者)のメール

create index if not exists proposals_mail_pending_idx
  on enger.proposals ((pending_mail is not null)) where pending_mail is not null;

comment on column enger.proposals.pending_mail is '承認待ちメール下書き（案件側／人材側）。承認者が承認時に送信し、その後 NULL に戻す。';
comment on column enger.proposals.mail_sent_at is 'メール送信完了日時';
comment on column enger.proposals.mail_sent_by is '送信を実行した承認者のメール（監査用）';
