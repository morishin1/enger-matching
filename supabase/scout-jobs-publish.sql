-- ============================================================
-- スカウト済み案件を「案件を探す（おすすめ一覧）」へ即時同期（バックフィル）
--   背景：フリーランス(enger.jp)の「案件を探す／お気に入り案件」は
--         enger.jobs.is_published = true の案件しか取得・表示しない。
--         お気に入り(enger.job_favorites)も job_id(= jobs.id) が必須。
--         スカウト送信時に対象案件が未公開だと、
--           ・おすすめ一覧に対象が無く、お気に入り登録しても反映されない
--           ・スカウトに job_id が紐づかず、応募画面のハートも効かない
--         という不具合になる（「登録済み表示なのに実体なし」）。
--   対応：これまでに送信済みのスカウトが指す案件をすべて公開化し、
--         未解決の scout.job_id / chat_threads.job_id を補完する。
--   ※ 今後のスカウト送信は sendScout 側で自動公開・自動紐づけする。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- 1) スカウトが指す案件を公開化（job_id 経由 ＋ job_no 経由の両系統）。
update enger.jobs j
set is_published = true
where coalesce(j.is_published, false) <> true
  and (
    j.id in (select s.job_id from enger.scouts s where s.job_id is not null)
    or j.job_no::text in (
      select s.job_no from enger.scouts s
      where s.job_no is not null and s.job_no ~ '^[0-9]+$'
    )
  );

-- 2) job_no はあるが job_id 未解決のスカウトに、公開案件の id を補完。
update enger.scouts s
set job_id = j.id
from enger.jobs j
where s.job_id is null
  and s.job_no is not null and s.job_no ~ '^[0-9]+$'
  and j.job_no::text = s.job_no
  and j.is_published = true;

-- 3) スカウト起点のチャットスレッドにも案件 UUID を補完（応募/お気に入り紐づけ用）。
update enger.chat_threads t
set job_id = s.job_id
from enger.scouts s
where t.scout_id = s.id
  and t.job_id is null
  and s.job_id is not null;

-- 確認
-- select engineer_name, job_no, job_id, job_title, status, created_at
-- from enger.scouts order by created_at desc limit 20;
