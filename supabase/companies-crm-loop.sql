-- ============================================================
-- 企業カルテ強化（クロージング学習ループ）用の追加列。
--   ① 対応特性タグ：連絡手段の当たり／レス速度／決裁速度を構造化して属人知を資産化。
--   ② WEB評判AI要約：企業サイト等をAIが要約した「参考情報（要確認）」を保存。
--   ※ 取引注意（caution / caution_reason / caution_at / caution_by）は close-reason-caution.sql で既出。
--      本ファイルでは追加しない（企業モーダルから編集できるよう UI 側で既存列を使う）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- ① 対応特性タグ（自由な運用に耐えるよう text。UI は select で候補提示）
alter table enger.companies add column if not exists contact_pref   text;   -- 連絡手段の当たり（電話NG/メール推奨/電話OK 等）
alter table enger.companies add column if not exists response_speed text;   -- レス速度（速い/普通/遅い）
alter table enger.companies add column if not exists decision_speed text;   -- 決裁速度（速い/普通/遅い）

comment on column enger.companies.contact_pref   is '連絡手段の当たり（電話NG/メール推奨等）。担当の勘を全員で共有するための構造化タグ';
comment on column enger.companies.response_speed is 'レスの速さ（速い/普通/遅い）';
comment on column enger.companies.decision_speed is '決裁の速さ（速い/普通/遅い）';

-- ② WEB評判のAI要約（外部評判の参考情報。あくまで「要確認」）
alter table enger.companies add column if not exists web_reputation        text;        -- AIが要約した評判サマリ（未検証）
alter table enger.companies add column if not exists web_reputation_source text;        -- 参照した情報源（URL 等）
alter table enger.companies add column if not exists web_reputation_at     timestamptz; -- 取得/生成日時
alter table enger.companies add column if not exists web_reputation_by     text;        -- 実行した担当

comment on column enger.companies.web_reputation        is 'AIが要約したWEB評判の参考情報（未検証＝要確認。担当が裏取りする前提）';
comment on column enger.companies.web_reputation_source is '要約の情報源（企業サイト/口コミページ/記事のURL等）';

-- 確認用：
-- select name, contact_pref, response_speed, decision_speed, caution, web_reputation_at from enger.companies limit 20;
