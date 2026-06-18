-- candidates に「取込元メールの件名」を保存する列を追加。
--   メール送信時に Re: <元件名> として人材側の SES窓口/エージェント宛て返信を成立させる。
--   Gmail はこの件名一致＋同じ送信者/受信者でスレッド統合し、相手の受信箱に「返信」として届く。
--   未マイグレ環境でもアプリは動く（フォールバック実装あり）。
alter table enger.candidates add column if not exists source_mail_subject text;
comment on column enger.candidates.source_mail_subject is '取込元メール(inbox_emails.subject)の件名スナップショット。メール送信時の Re: 件名生成に利用。';
