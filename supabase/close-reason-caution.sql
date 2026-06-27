-- ============================================================
-- 提案管理の詳細からの「案件/人材クローズ」用の追加列。
--   ・jobs/candidates にクローズ理由・日時・実行者を保持（理由は常に必須）。
--   ・companies に「取引注意（caution）」フラグを追加し、クローズ理由を連動記録する。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- クローズ理由（案件側）
alter table enger.jobs       add column if not exists closed_reason text;
alter table enger.jobs       add column if not exists closed_at     timestamptz;
alter table enger.jobs       add column if not exists closed_by     text;
-- クローズ理由（人材側）
alter table enger.candidates add column if not exists closed_reason text;
alter table enger.candidates add column if not exists closed_at     timestamptz;
alter table enger.candidates add column if not exists closed_by     text;

-- 会社評価：取引注意フラグ（is_ng=取引NG より弱い「注意」）。
alter table enger.companies add column if not exists caution        boolean not null default false;
alter table enger.companies add column if not exists caution_reason text;
alter table enger.companies add column if not exists caution_at     timestamptz;
alter table enger.companies add column if not exists caution_by     text;
create index if not exists companies_caution_idx on enger.companies (caution) where caution = true;

-- 確認用：
-- select name, caution, caution_reason from enger.companies where caution limit 20;
