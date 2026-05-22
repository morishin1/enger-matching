-- ============================================================
-- 担当者マスタ enger.staff（提案者 / クロージング担当を追加・削除できるように）
--   設定ページ(/settings)から管理。提案管理の選択肢に反映される。
-- ============================================================

create table if not exists enger.staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  email       text,                            -- ログイン用メール(許可リスト/操作者識別)
  is_proposer boolean not null default true,   -- 提案者の候補
  is_closer   boolean not null default false,  -- クロージング担当の候補
  sort        int default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- 既存テーブルに email 列を追加（再実行用）
alter table enger.staff add column if not exists email text;

alter table enger.staff enable row level security;
drop policy if exists staff_read on enger.staff;
create policy staff_read on enger.staff for select using (true);
grant select on enger.staff to anon, authenticated;
grant all on enger.staff to service_role;

-- 初期データ（現行の運用名）。重複は無視。
insert into enger.staff (name, is_proposer, is_closer, sort) values
  ('工藤', true,  true,  1),
  ('結城', true,  false, 2),
  ('藤本', true,  false, 3),
  ('寺本', false, true,  4),
  ('野澤', false, true,  5)
on conflict (name) do nothing;

-- 確認
-- select * from enger.staff order by sort;
