-- 受信メール（Gmail 同期）テーブル。
--   Gmail API で取得した生メールを保存し、ENGER /inbox でAI抽出する。
--   - 同期は手動（営業が「📥 同期」ボタン押下）
--   - AI抽出も手動（営業が「✨ AI抽出」ボタン押下）→ Claude Haiku 1通あたり 0.7円程度
--   - 既存の jobs/candidates テーブルに登録すると extracted_job_id / extracted_candidate_id で紐付け

create table if not exists enger.inbox_emails (
  id                    uuid primary key default gen_random_uuid(),
  gmail_message_id      text not null unique,    -- Gmail Message ID (重複取込防止)
  gmail_thread_id       text,
  subject               text,
  from_email            text,
  from_name             text,
  to_email              text,
  body                  text,                    -- 本文(プレーンテキスト)
  body_html             text,                    -- 本文(HTML・将来用・空でも可)
  has_attachment        boolean default false,
  attachment_names      text[],                  -- ファイル名のみ（中身は取得しない）
  received_at           timestamptz,             -- Gmail から取った受信日時
  synced_at             timestamptz not null default now(),

  -- AI抽出関連
  extracted_at          timestamptz,             -- いつ AI抽出したか
  extracted_kind        text,                    -- "job" / "candidate" / "skip" / "spam"
  extracted_data        jsonb,                   -- Claude が返した構造化データ
  extracted_summary     text,                    -- 一行要約（一覧表示用）

  -- 登録結果（jobs/candidates テーブルへの link）
  registered_at         timestamptz,
  registered_job_no     int,
  registered_candidate_no int,
  registered_by_email   text,
  skipped_reason        text,

  -- フィルタ
  is_archived           boolean default false    -- 営業が「アーカイブ」した（一覧から消す）
);

create index if not exists inbox_emails_received_idx on enger.inbox_emails (received_at desc);
create index if not exists inbox_emails_status_idx on enger.inbox_emails (extracted_at, is_archived);

alter table enger.inbox_emails enable row level security;
grant select on enger.inbox_emails to anon, authenticated;
grant all on enger.inbox_emails to service_role;

comment on table  enger.inbox_emails is 'Gmail同期した受信メール。AIに通すかは営業が手動で判断（コスト最適化）。';
comment on column enger.inbox_emails.extracted_kind is 'AI抽出結果: job(案件)/candidate(人材)/skip(無関係)/spam';
