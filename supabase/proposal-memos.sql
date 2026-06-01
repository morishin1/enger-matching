-- 提案メモ。提案ごとに「連絡記録/重要事項/内部メモ/クライアント対応/人材対応」を
-- スレッドで残し、対応履歴の可視化と抜け漏れ防止につなげる。
create table if not exists enger.proposal_memos (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references enger.proposals(id) on delete cascade,
  category       text not null,             -- 連絡記録 / 重要事項 / 内部メモ / クライアント対応 / 人材対応
  body           text not null,
  created_by_email text,
  created_by_name  text,
  created_at     timestamptz not null default now()
);
create index if not exists proposal_memos_proposal_idx on enger.proposal_memos (proposal_id, created_at desc);

alter table enger.proposal_memos enable row level security;
-- 案件・人材と同じく anon/authenticated に SELECT のみ、service_role に全権限。
grant select on enger.proposal_memos to anon, authenticated;
grant all    on enger.proposal_memos to service_role;

comment on table enger.proposal_memos is '提案ごとの対応メモ。カテゴリで分類し、対応履歴の可視化に使う。';
comment on column enger.proposal_memos.category is '連絡記録 / 重要事項 / 内部メモ / クライアント対応 / 人材対応';
