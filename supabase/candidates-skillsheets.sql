-- ============================================================
-- 人材マスタにスキルシート（複数・署名URL）列を追加 — enger.candidates.skill_sheets（管理NO #250）
--   ・フリーランスから人材マスタへ登録する際、フリーランス側 skill_sheets（最大3件）を
--     人材マスタへ引き継ぐ。各要素は {url, name, path, uploaded_at, expires_at} の形式。
--   ・url は Supabase Storage の署名URL（ログイン不要でプレビュー/ダウンロード可・期間限定）。
--   ・旧・単一カラム skill_sheet_url は後方互換（先頭1件の url を同期）。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.candidates add column if not exists skill_sheets jsonb;

comment on column enger.candidates.skill_sheets is 'スキルシート（最大3件）。[{url(署名URL), name, path, uploaded_at, expires_at}]。フリーランス連携(#250)で引き継ぐ。';

-- 確認
-- select candidate_no, name, jsonb_array_length(coalesce(skill_sheets,'[]'::jsonb)) as sheets
--   from enger.candidates where skill_sheets is not null order by candidate_no desc limit 20;
