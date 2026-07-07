-- ============================================================
-- enger.candidates に「使用経験のあるツール・開発環境」列を追加（#325・冪等）
--   人材詳細（ドロワー／プロフィール詳細）の編集フォームで手入力・保存でき、
--   フリーランス→人材マスタ登録の取り込み時にも反映する（名前配列 text[]）。
--   中央 Supabase の SQL Editor で実行（何度実行しても安全）。
-- ============================================================

alter table enger.candidates add column if not exists tools text[] not null default '{}';

comment on column enger.candidates.tools is '使用経験のあるツール・開発環境（名前配列）。人材詳細の編集フォーム／フリーランス取込で設定。';

-- 確認
-- select candidate_no, name, skills, tools from enger.candidates where cardinality(tools) > 0 limit 20;
