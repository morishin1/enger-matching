-- ============================================================
-- #388②：人材マスタに「経験業種」列を追加。
--   ENGERフリーランス側（public.profiles.industries：業種＋経験年数の選択）を
--   「業種（年数）, 業種（年数）」のテキストで保持する。
--   「人材マスタへ新規登録」フォームおよび「プロフィールを更新」で書き込まれる。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.candidates add column if not exists industries text;

comment on column enger.candidates.industries is
  '#388②：経験業種。「業種（経験年数）」のカンマ区切りテキスト（例：金融業（3〜5年）, ゲーム業界）';

-- 確認用：
-- select candidate_no, name, industries from enger.candidates where industries is not null limit 20;
