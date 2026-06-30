-- ============================================================
-- フリーランス氏名スナップショット — enger.freelance_name_snapshots（管理NO #241）
--   目的：ENGERフリーランス(enger.jp)側のログアウト等で public.profiles の漢字氏名が
--         一時的に空になっても、DX（マッチング→フリーランス一覧／人材詳細）では
--         「直近に保存された氏名」を表示し続ける（人材ID E-XXXXX に化けない）。
--   仕様：
--     ・DX が profiles から日本語の漢字氏名を解決できた時、その 氏名(漢字)/フリガナ/イニシャル を
--       ここへ upsert（＝最後に確認できた正しい氏名を保存）。
--     ・解決できない時は、ここに保存済みの値を表示にフォールバックする。
--     ・フリーランスが氏名を別の名前に変更すれば、次回解決時に新しい氏名で上書きされる。
--   ※ 人材の氏名スナップショット＝社内用データ。service role のみ参照/更新（anon/authenticated には付与しない）。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。再実行で列/権限を自己修復する。
-- ============================================================

create table if not exists enger.freelance_name_snapshots (
  engineer_id text primary key,          -- public.profiles.id
  kanji       text,                      -- 姓名（漢字）。例: 藤本 太郎
  kana        text,                      -- フリガナ
  initials    text,                      -- イニシャル（例: FT）
  updated_at  timestamptz not null default now()
);

-- 既存テーブルが列欠落で存在しても自己修復（CREATE TABLE IF NOT EXISTS は既存テーブルに列を足さないため）。
alter table enger.freelance_name_snapshots add column if not exists kanji      text;
alter table enger.freelance_name_snapshots add column if not exists kana       text;
alter table enger.freelance_name_snapshots add column if not exists initials   text;
alter table enger.freelance_name_snapshots add column if not exists updated_at timestamptz not null default now();

alter table enger.freelance_name_snapshots enable row level security;
-- 参照/更新は DX サーバ(service role)のみ。RLSは有効化しつつポリシー無し＝外部からは不可視。
--   多層防御として anon/authenticated の権限を明示的に剥奪（他のスタッフ専用テーブルと同方針）。
revoke all on enger.freelance_name_snapshots from anon, authenticated;
grant usage on schema enger to service_role;
grant all on enger.freelance_name_snapshots to service_role;

-- 確認
-- select engineer_id, kanji, kana, initials, updated_at
--   from enger.freelance_name_snapshots order by updated_at desc limit 20;
