-- ============================================================
-- PR・X集客の投稿ログ  enger.pr_posts
--   /pr で「Xに投稿」した記録。ダッシュボードの「今日のPRアラート」と
--   管理者の「担当別PR実施状況」に使用。書込は service_role。
-- ============================================================

create table if not exists enger.pr_posts (
  id         uuid primary key default gen_random_uuid(),
  operator   text,                          -- 投稿した担当者名
  kind       text,                          -- count / jobs / value 等
  created_at timestamptz not null default now()
);

-- 投稿本文・リンク（「履歴」タブで実際に投稿した内容を表示する）。
--   後方互換のため nullable。列が無い環境でも logPrPost はフォールバックで記録できる。
alter table enger.pr_posts add column if not exists text text;   -- 投稿本文（Xに流し込んだ文面）
alter table enger.pr_posts add column if not exists url  text;   -- 投稿リンク（案件カード/シェア等の遷移先）

create index if not exists pr_posts_operator_idx on enger.pr_posts (operator, created_at desc);
create index if not exists pr_posts_created_idx  on enger.pr_posts (created_at desc);

alter table enger.pr_posts enable row level security;
grant all on enger.pr_posts to service_role;
grant select on enger.pr_posts to anon, authenticated;
drop policy if exists pr_posts_read on enger.pr_posts;
create policy pr_posts_read on enger.pr_posts for select using (true);

-- 確認
-- select operator, kind, created_at from enger.pr_posts order by created_at desc limit 20;
