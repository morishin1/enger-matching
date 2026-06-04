-- ============================================================
-- パートナー企業(partner)ロール ＋ テナント分離（情報漏洩防止）
--   partner は「自社で登録した案件/人材」＋「共有された案件/人材」だけを見られる。
--   他社分は匿名化して表示（氏名・連絡先・クライアント名・送信元メール等は非表示）。
-- ============================================================

-- 1) partner ロールを許可
alter table enger.app_users drop constraint if exists app_users_role_check;
alter table enger.app_users
  add constraint app_users_role_check check (role in ('admin','agent','client','candidate','partner'));

-- 2) 所有テナント(owner_company)と共有フラグ(shared)
--    owner_company: 登録したパートナー企業名（app_users.company_name）。社内登録は null＝社内所有。
--    shared: true なら他社（パートナー）にも匿名で見せてよい。
alter table enger.candidates add column if not exists owner_company text;
alter table enger.candidates add column if not exists shared boolean not null default false;
alter table enger.jobs       add column if not exists owner_company text;
alter table enger.jobs       add column if not exists shared boolean not null default false;
alter table enger.proposals  add column if not exists owner_company text;

create index if not exists candidates_owner_company_idx on enger.candidates (owner_company);
create index if not exists candidates_shared_idx        on enger.candidates (shared);
create index if not exists jobs_owner_company_idx        on enger.jobs (owner_company);
create index if not exists jobs_shared_idx               on enger.jobs (shared);
create index if not exists proposals_owner_company_idx   on enger.proposals (owner_company);
