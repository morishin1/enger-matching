-- 元メール受信日時カラム。再取込時に「最新メールを元メールに残す」ための比較に使う。
--   同一案件/人材の新旧メールが1バッチで取り込まれると、処理順（received_at 降順）の都合で
--   最古のメールリンクが最後に上書きしてしまう順序依存バグがあった。
--   source_mail_at を持たせ、受信日時が新しいときだけ source_mail_url / source_mail_subject を
--   上書きすることで、常に最新メールのリンク/件名が残る（＝送信時に最新メールへの返信になる）。
alter table enger.candidates add column if not exists source_mail_at timestamptz;
alter table enger.jobs       add column if not exists source_mail_at timestamptz;

comment on column enger.candidates.source_mail_at is '元メール(取込元)の受信日時。最新メールを元メールに残す上書き判定に使用。';
comment on column enger.jobs.source_mail_at       is '元メール(取込元)の受信日時。最新メールを元メールに残す上書き判定に使用。';
