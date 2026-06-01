-- 面談の詳細情報を提案レコードに保存する列。既存の meeting_date / meeting_status は維持。
--   meeting_time:      時間（HH:MM）
--   meeting_format:    形式（オンライン(Zoom) / 対面 / 電話 / その他 など）
--   meeting_url:       オンライン面談URL
--   meeting_attendees: 参加者（自由記述。例: 田中、クライアント山田様）
--   meeting_note:      備考（面談の目的・質問事項など）

alter table enger.proposals add column if not exists meeting_time      text;
alter table enger.proposals add column if not exists meeting_format    text;
alter table enger.proposals add column if not exists meeting_url       text;
alter table enger.proposals add column if not exists meeting_attendees text;
alter table enger.proposals add column if not exists meeting_note      text;

comment on column enger.proposals.meeting_time      is '面談時間 (HH:MM)';
comment on column enger.proposals.meeting_format    is '面談形式（オンライン(Zoom) / 対面 / 電話 / その他）';
comment on column enger.proposals.meeting_url       is 'オンライン面談URL';
comment on column enger.proposals.meeting_attendees is '面談参加者（自由記述）';
comment on column enger.proposals.meeting_note      is '面談の備考（目的・質問事項など）';
