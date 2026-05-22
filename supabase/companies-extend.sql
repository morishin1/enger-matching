-- ============================================================
-- 企業マスタ enger.companies を「分析の基礎データ」として拡張 (冪等)
--   手動登録した企業に連絡先・業種・担当・メモ等を持たせ、案件/提案/打合せの
--   ハブにする。案件のクライアント名(jobs.client_name)とは name で名寄せ。
-- ============================================================

alter table enger.companies add column if not exists contact_email text;   -- 窓口メール
alter table enger.companies add column if not exists contact_name  text;   -- 窓口担当者名
alter table enger.companies add column if not exists phone         text;   -- 電話
alter table enger.companies add column if not exists website       text;   -- URL
alter table enger.companies add column if not exists address       text;   -- 所在地
alter table enger.companies add column if not exists owner_staff    text;  -- 自社の担当(担当者マスタの名前)

-- name で名寄せ・upsert できるよう一意制約
create unique index if not exists companies_name_uniq on enger.companies (name);

-- 確認
-- select name, industry, owner_staff, contact_email from enger.companies order by name;
