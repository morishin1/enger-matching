-- ============================================================
-- 企業マスタに「最終連絡日」を追加（3ヶ月ごとのフォロー管理用）
--   ご無沙汰企業リスト＝ last_contacted_at / 直近案件 / 直近打合せ が90日超の企業
-- ============================================================

alter table enger.companies add column if not exists last_contacted_at timestamptz;

-- 確認:
-- select name, last_contacted_at from enger.companies order by last_contacted_at nulls first limit 20;
