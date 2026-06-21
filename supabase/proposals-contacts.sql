-- ============================================================
-- 提案（詳細）の連絡先まわりを拡張 (冪等)
--   案件側 / 人材側それぞれに「会社名・企業担当（窓口担当者）・先方担当」を保持。
--   既存:
--     company         … 案件側クライアント名
--     client_contact  … 案件側 先方担当
--   追加:
--     company_contact      … 案件側 企業担当（企業記録の窓口担当者を自動表示・編集可）
--     cand_company         … 人材側 会社名（人材の所属会社を自動表示・編集可）
--     cand_company_contact … 人材側 企業担当（企業記録の窓口担当者を自動表示・編集可）
--     cand_contact         … 人材側 先方担当（初期空欄・編集可）
-- ============================================================

alter table enger.proposals add column if not exists company_contact      text;
alter table enger.proposals add column if not exists cand_company         text;
alter table enger.proposals add column if not exists cand_company_contact text;
alter table enger.proposals add column if not exists cand_contact         text;
