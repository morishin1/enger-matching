-- ============================================================
-- スカウトに案件 job_id を紐づけるバックフィル（A方式：DX側でID連携）
--   背景：フリーランス(enger.jp)の「お気に入り登録」は
--         enger.job_favorites.job_id(= enger.jobs.id, UUID) が必須。
--         スカウト送信時に enger.scouts.job_id が null だと、LP側が案件を
--         解決できず、お気に入りが「登録済み表示なのに反映されない」状態になる。
--   対応：これまでに送信済みのスカウトについて、job_no から実在案件を解決して
--         scout.job_id（＋スレッドの chat_threads.job_id）を補完する。
--   ※ 今後のスカウト送信は sendScout 側で job_id を自動解決・保存する。
--   ※ is_published は変更しない（案件を全フリーランスのおすすめ一覧へ露出させない）。
--      LP側はスカウトの job_id を起点に対象案件を候補注入して表示する。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- 1) job_no はあるが job_id 未解決のスカウトに、実在案件(削除済み除く)の id を補完。
--    job_no は表記ゆれ（"No.1554" / "#1554" / ゼロ埋め）があり得るため数字だけを抽出して突き合わせる。
update enger.scouts s
set job_id = j.id
from enger.jobs j
where s.job_id is null
  and s.job_no is not null
  and nullif(regexp_replace(s.job_no, '\D', '', 'g'), '') is not null
  and j.deleted_at is null
  and j.job_no = nullif(regexp_replace(s.job_no, '\D', '', 'g'), '')::int;

-- 2) スカウト起点のチャットスレッドにも案件 UUID を補完（応募/お気に入り紐づけ用）。
update enger.chat_threads t
set job_id = s.job_id
from enger.scouts s
where t.scout_id = s.id
  and t.job_id is null
  and s.job_id is not null;

-- 確認：job_id がまだ埋まらないスカウト（案件マスタ未登録 or job_no 不整合の可能性）。
-- select id, engineer_name, job_no, job_id, job_title, created_at
--   from enger.scouts
--  where job_id is null and job_no is not null
--  order by created_at desc limit 50;
