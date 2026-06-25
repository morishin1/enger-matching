-- ============================================================
-- 「確認中」フォルダ滞留通知用カラム — enger.proposals.confirm_notified_at
--   確認中フォルダに入ってから3日以上 何も記録の変更がない提案について、
--   翌日にクロージング担当者へメール通知する（/api/cron/confirm-stale）。
--   多重送信を防ぐため、最後に通知した日時を保持する。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.proposals add column if not exists confirm_notified_at timestamptz;

comment on column enger.proposals.confirm_notified_at is
  '確認中フォルダ滞留通知を最後に送った日時。updated_at がこれより新しくなれば再通知の対象になる。';
