-- ============================================================
-- 応募・お気に入り — enger.applications / enger.job_favorites
--   エンジニア(enger.jp)が案件に「応募」「お気に入り」する。
--   応募は dx(営業)が確認できる（スカウトの逆方向）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- ---------- 応募 ----------
create table if not exists enger.applications (
  id            uuid primary key default gen_random_uuid(),
  engineer_id   uuid not null,                 -- 応募者 public.profiles.id
  engineer_name text,
  job_id        uuid,                          -- enger.jobs.id
  job_no        text,                          -- 案件番号（表示用）
  job_title     text,
  message       text,                          -- 一言（任意）
  status        text not null default 'applied', -- applied | reviewing | passed | rejected
  created_at    timestamptz not null default now()
);
create unique index if not exists applications_uniq on enger.applications (engineer_id, job_id);
create index if not exists applications_job_idx on enger.applications (job_id, created_at desc);
create index if not exists applications_eng_idx on enger.applications (engineer_id, created_at desc);

alter table enger.applications enable row level security;
-- dx(営業)は anon キーで一覧取得するため select 許可（既存テーブルと同方針）
drop policy if exists applications_read on enger.applications;
create policy applications_read on enger.applications for select using (true);
grant select on enger.applications to anon, authenticated;
grant all on enger.applications to service_role;

-- ---------- お気に入り（個人保存） ----------
create table if not exists enger.job_favorites (
  engineer_id uuid not null,                   -- public.profiles.id
  job_id      uuid not null,                   -- enger.jobs.id
  created_at  timestamptz not null default now(),
  primary key (engineer_id, job_id)
);

alter table enger.job_favorites enable row level security;
-- 本人のみ読み書き（LPはservice roleで操作するが、念のため本人ポリシーも付与）
drop policy if exists job_favorites_own on enger.job_favorites;
create policy job_favorites_own on enger.job_favorites
  for all using (auth.uid() = engineer_id) with check (auth.uid() = engineer_id);
grant select, insert, delete on enger.job_favorites to authenticated;
grant all on enger.job_favorites to service_role;

-- 確認
-- select engineer_name, job_title, status, created_at from enger.applications order by created_at desc limit 20;
