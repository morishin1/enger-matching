-- ============================================================
-- #368：案件に「フリーランスNG」フラグを追加するための列。
--   フリーランス人材を提案してはいけない案件を、担当が案件詳細で明示する。
--   国籍制限（nationality_requirement）と同様、提案前チェック用の社内フラグ。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.jobs add column if not exists freelance_ng boolean not null default false;

comment on column enger.jobs.freelance_ng is '案件がフリーランス人材NGか（担当が明示）。true=フリーランス提案不可。提案前チェック用の社内フラグ。';

-- 確認用：
-- select job_no, title, freelance_ng from enger.jobs where freelance_ng is true limit 20;
