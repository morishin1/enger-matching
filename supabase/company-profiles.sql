-- ============================================================
-- 企業プロフィール / Mission — enger.company_profiles
--   企業(client)が自社のMission・カルチャー・求める人物像を登録。
--   マッチングの文脈やエンジニアへの訴求に活用（方向性に合う人材の採用）。
--   company（会社名）をキーに、既存の client_name 名寄せと整合させる。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.company_profiles (
  company        text primary key,             -- 会社名（app_users.company_name と一致）
  mission        text,                          -- ミッション・事業の目的
  culture        text,                          -- カルチャー・働き方・バリュー
  ideal_persona  text,                          -- 求める人物像
  appeal         text,                          -- 自社の魅力・アピール
  website        text,
  updated_at     timestamptz not null default now()
);

alter table enger.company_profiles enable row level security;
drop policy if exists company_profiles_read on enger.company_profiles;
create policy company_profiles_read on enger.company_profiles for select using (true);
grant select on enger.company_profiles to anon, authenticated;
grant all on enger.company_profiles to service_role;

-- 確認
-- select company, left(mission,40), updated_at from enger.company_profiles order by updated_at desc limit 20;
