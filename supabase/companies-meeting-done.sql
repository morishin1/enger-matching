-- 企業の「打ち合わせ完了」手動フラグ。
--   ・meeting_done    : true=担当が「この企業とは打合せ/顔合わせ済」と手動チェック
--   ・meeting_done_at : チェックした日時
--   ・meeting_done_by : チェックした担当者名（監査用・任意）
--
--   ※ 自動判定（meetings テーブルに記録がある＝打合せ済）とは別に、手動でも
--     「打合せ済」にできるようにするための列。企業一覧のバッジ/フィルタは
--     「meetings に記録あり OR meeting_done=true」で「打合せ済」と判定する。

alter table enger.companies
  add column if not exists meeting_done     boolean not null default false,
  add column if not exists meeting_done_at  timestamptz,
  add column if not exists meeting_done_by  text;

create index if not exists companies_meeting_done_idx on enger.companies (meeting_done);

comment on column enger.companies.meeting_done    is '打ち合わせ完了の手動フラグ（詳細画面でチェック）';
comment on column enger.companies.meeting_done_at is '打ち合わせ完了にした日時';
comment on column enger.companies.meeting_done_by is '打ち合わせ完了にした担当者名';
