-- ============================================================
-- enger.candidates に 管理NO + 人材CSV(人材_統合.csv)の拡張カラムを追加 (冪等)
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

-- 管理NO (連番・自動採番)。表示は P-00001 形式。
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='enger' and table_name='candidates' and column_name='candidate_no'
  ) then
    alter table enger.candidates add column candidate_no bigint generated always as identity;
  end if;
end $$;
create unique index if not exists candidates_no_uniq on enger.candidates (candidate_no);

-- マッチング精度向上のための構造化フィールド
alter table enger.candidates add column if not exists salary_min     numeric;   -- 希望単価下限(万円)
alter table enger.candidates add column if not exists salary_max     numeric;   -- 希望単価上限(万円)
alter table enger.candidates add column if not exists age_band       text;      -- 年齢層
alter table enger.candidates add column if not exists nationality    text;      -- 国籍
alter table enger.candidates add column if not exists skill_level    text;      -- スキルレベル
alter table enger.candidates add column if not exists work_days       text;      -- 週稼働可能日数
alter table enger.candidates add column if not exists remote_pref     text;      -- リモート希望
alter table enger.candidates add column if not exists japanese_level  text;      -- 日本語レベル
alter table enger.candidates add column if not exists comm            text;      -- コミュニケーション力
alter table enger.candidates add column if not exists affiliation     text;      -- 所属(プロパー/フリーランス等)
alter table enger.candidates add column if not exists source_company  text;      -- 会社名(取込元SES)
alter table enger.candidates add column if not exists start_date      date;      -- 稼働開始可能日
alter table enger.candidates add column if not exists note            text;      -- 備考

-- スキル配列のオーバーラップ検索を高速化 (マッチングの prefilter 用)
create index if not exists candidates_skills_idx on enger.candidates using gin (skills);

-- 確認
-- select count(*) from enger.candidates;
