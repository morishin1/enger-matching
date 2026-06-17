-- mail_sent に SMTP 診断情報の列を追加。
--   nodemailer.sendMail() が返す response / accepted / rejected を保存し、
--   「アプリ上は送信成功だが受信者に届かない」（Workspace の post-SMTP silent drop 等）
--   事象を後追いできるようにする。
--   ・smtp_response  : SMTP 応答行（例: "250 2.0.0 OK 1718...."）
--   ・smtp_accepted  : 受理された宛先（カンマ区切り）
--   ・smtp_rejected  : 拒否された宛先（カンマ区切り。通常は空のはず）
alter table enger.mail_sent add column if not exists smtp_response text;
alter table enger.mail_sent add column if not exists smtp_accepted text;
alter table enger.mail_sent add column if not exists smtp_rejected text;

comment on column enger.mail_sent.smtp_response is 'nodemailer 経由の SMTP 応答行（"250 2.0.0 OK ..." 等・診断用）。';
comment on column enger.mail_sent.smtp_accepted is 'SMTP が受理した宛先（カンマ区切り）。';
comment on column enger.mail_sent.smtp_rejected is 'SMTP が拒否した宛先（カンマ区切り）。通常は空。';
