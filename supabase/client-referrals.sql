-- ============================================================
-- 企業からの「エージェントに人材を紹介」 — enger.client_referrals
--   企業ダッシュボード（ENGER business）の「エージェントに紹介」モーダルから送信される。
--   人材マスタ（candidates）へ直接登録はせず、まず紹介としてエージェントが受け取り、
--   内容を確認のうえ人材登録（registered_candidate_no に紐づけ）する運用。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.client_referrals (
  id            uuid primary key default gen_random_uuid(),
  company       text not null,                 -- 紹介元企業（app_users.company_name）
  referred_by   text,                          -- 紹介した担当者のメール
  name          text,                          -- 氏名（任意。エージェントのみ閲覧）
  initials      text,                          -- イニシャル
  title         text,                          -- 職種
  skills        text[] not null default '{}',
  rate          text,                          -- 希望単価の表記
  exp           text,                          -- 経験年数
  avail         text,                          -- 稼働開始
  location      text,                          -- 最寄駅
  note          text,                          -- 補足（並行状況・商流など）
  status        text not null default 'new',   -- new(未対応) | contacted(対応中) | registered(人材登録済) | closed(見送り)
  registered_candidate_no integer,             -- 人材登録した場合の candidate_no
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists client_referrals_company_idx on enger.client_referrals (company, created_at desc);
create index if not exists client_referrals_status_idx  on enger.client_referrals (status);

alter table enger.client_referrals enable row level security;
drop policy if exists client_referrals_read on enger.client_referrals;
create policy client_referrals_read on enger.client_referrals for select using (true);
grant select on enger.client_referrals to anon, authenticated;
grant all on enger.client_referrals to service_role;

comment on table enger.client_referrals is '企業からエージェントへの人材紹介（ENGER business「エージェントに紹介」モーダル）';

-- 確認
-- select company, initials, title, status, created_at from enger.client_referrals order by created_at desc limit 20;
