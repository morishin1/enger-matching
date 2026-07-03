-- ============================================================
-- 企業ID（enger.companies.company_no）— #293
--   提案管理の「自社担当」自動表示（#287）は会社名の文字列一致（表記ゆれ吸収の
--   フォールバック付き）で企業マスタと連携している。これをより確実にするため、
--   企業マスタに安定した「企業ID」を導入する。
--   ・既存の全企業に自動採番（列追加と同時に Postgres が backfill する。手動 UPDATE 不要）。
--   ・今後新しく登録される企業にも自動採番（generated always as identity のため
--     アプリ側の実装（トリガ/シーケンス操作）は一切不要）。
--   ・表示形式はアプリ側で整形する（例: "C-00001" ＝ lib/companies.ts の companyIdLabel）。
--   ・job_no / candidate_no と同じ実装パターン（candidates-columns.sql 参照）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'enger' and table_name = 'companies' and column_name = 'company_no'
  ) then
    alter table enger.companies add column company_no bigint generated always as identity;
  end if;
end $$;

create unique index if not exists companies_no_uniq on enger.companies (company_no);

-- 確認
-- select name, company_no, owner_staff from enger.companies order by company_no limit 20;
