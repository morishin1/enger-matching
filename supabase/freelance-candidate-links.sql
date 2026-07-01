-- ============================================================
-- フリーランス ↔ 人材マスタ 連携リンク — enger.freelance_candidate_links（管理NO #250）
--   目的：ENGERフリーランス（public.profiles.id ＝ E番号の元）と、
--         人材マスタ（enger.candidates.id ＝ P番号）を 1:1 で強固に紐付ける。
--   用途：
--     ・「人材マスタへ新規登録」確定時にこの行を作成（E番号↔P番号を有効化）。
--     ・フリーランスが応募（enger.applications）した時、engineer_id からこの紐付けで
--       candidate_id（P番号）を判別し、提案ボードのレコードへ自動で結びつける。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.freelance_candidate_links (
  engineer_id   uuid primary key,                -- public.profiles.id（フリーランス＝E番号の元）。1人につき1マスタまで。
  candidate_id  uuid not null,                   -- enger.candidates.id（人材マスタ＝P番号）
  candidate_no  bigint,                          -- enger.candidates.candidate_no（P番号・表示/突合の冗長保持）
  linked_at     timestamptz not null default now(),
  linked_by     text                             -- 紐付けを確定した担当者名
);

-- 既存テーブルが列欠落でも自己修復（冪等）。
alter table enger.freelance_candidate_links add column if not exists candidate_no bigint;
alter table enger.freelance_candidate_links add column if not exists linked_at    timestamptz not null default now();
alter table enger.freelance_candidate_links add column if not exists linked_by    text;

create index if not exists freelance_candidate_links_candidate_idx on enger.freelance_candidate_links (candidate_id);

alter table enger.freelance_candidate_links enable row level security;
-- 読取は dx(anon/service)で広く閲覧、書込みは service role（dxサーバ経由）のみ。
drop policy if exists freelance_candidate_links_read on enger.freelance_candidate_links;
create policy freelance_candidate_links_read on enger.freelance_candidate_links for select using (true);
grant usage on schema enger to anon, authenticated, service_role;
grant select on enger.freelance_candidate_links to anon, authenticated;
grant all on enger.freelance_candidate_links to service_role;

-- 確認
-- select engineer_id, candidate_id, candidate_no, linked_by, linked_at
--   from enger.freelance_candidate_links order by linked_at desc limit 20;
