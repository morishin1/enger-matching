-- ============================================================
-- #310：案件詳細（編集）に「国籍制限」の選択欄を追加するための列。
--   選択肢は UI 側で 日本国籍のみ / 国籍不問 / 不明 の3択。テキストで保存する。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.jobs add column if not exists nationality_requirement text; -- 日本国籍のみ / 国籍不問 / 不明

comment on column enger.jobs.nationality_requirement is '案件の国籍制限（担当が明示選択）。日本国籍のみ / 国籍不問 / 不明';

-- 確認用：
-- select job_no, title, nationality_requirement from enger.jobs where nationality_requirement is not null limit 20;
