-- ============================================================
-- 企業による自社案件の掲載 + 契約種別 — enger.jobs に列追加
--   企業(client)がポータルから案件を下書き作成 → 審査中 →
--   管理者/営業が承認すると is_published=true で人材に公開される。
--   契約種別(SES/紹介/派遣)は案件ごとに複数選択。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.jobs add column if not exists contract_types   text[] not null default '{}';  -- SES / 紹介 / 派遣（複数可）
alter table enger.jobs add column if not exists posted_by_client boolean not null default false; -- 企業が掲載した案件か
alter table enger.jobs add column if not exists review_status    text;                            -- pending | approved | rejected（企業掲載のみ）
alter table enger.jobs add column if not exists posted_by_email  text;                            -- 掲載した企業アカウント

create index if not exists jobs_review_idx on enger.jobs (review_status) where review_status is not null;

-- 確認
-- select job_no, title, client_name, contract_types, posted_by_client, review_status, is_published
-- from enger.jobs where posted_by_client = true order by created_at desc;
