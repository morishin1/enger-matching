-- 日報への管理者返信の記録。誰がいつ何を返信したかを日報自体に残し、
-- 「どれに返答済みか」を一覧で判別できるようにする。
alter table enger.daily_reports add column if not exists replied_at  timestamptz;
alter table enger.daily_reports add column if not exists replied_by  text;
alter table enger.daily_reports add column if not exists reply_text  text;

comment on column enger.daily_reports.replied_at is '管理者が個別メッセージを送信した日時';
comment on column enger.daily_reports.replied_by is '返信した管理者名';
comment on column enger.daily_reports.reply_text is '送信した返信本文（最新のもの）';

-- 日報提出時の AI 自動返信を1回だけにするための記録。
alter table enger.daily_reports add column if not exists ai_replied_at timestamptz;
comment on column enger.daily_reports.ai_replied_at is '日報提出時に AI が自動で一言を返信した日時（重複送信防止）';
