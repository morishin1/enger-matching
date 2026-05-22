-- ============================================================
-- メール連携用の連絡先カラムを追加 (冪等)
--   案件=クライアント/取引先の窓口、人材=本人/所属(SES)の窓口メール。
--   メールボタンは Gmail 作成画面(返信形式)に遷移し、相手にアクションを促す。
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

-- 案件側: クライアント窓口メール
alter table enger.jobs       add column if not exists contact_email text;
alter table enger.jobs       add column if not exists contact_name  text;

-- 人材側: 本人/所属窓口メール
alter table enger.candidates add column if not exists email         text;
alter table enger.candidates add column if not exists contact_email text;  -- 所属(SES)窓口

-- 確認
-- select count(*) filter (where email is not null) as cand_with_email from enger.candidates;
