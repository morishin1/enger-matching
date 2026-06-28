-- ============================================================
-- スカウトに案件参照を付与 — enger.scouts.job_id / job_no, enger.chat_threads.job_id
--   dx(営業)がスカウト時に「案件ID(= enger.jobs.job_no, 数字)」を指定できるようにし、
--   フリーランス(enger.jp)側が
--     ・「応募画面へ」(/jobs?job_id=…) で対象案件のモーダルを開く
--     ・「お気に入りに登録」(enger.job_favorites.job_id) に対象案件を紐づける
--   を案件IDで正しく実行できるようにする。
--   ・job_id : 解決できた enger.jobs.id(UUID)。お気に入り紐づけ用。
--   ・job_no : 営業が入力した案件ID(表示番号 = jobs.job_no)。URL/表示用。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- ---- スカウト本体に案件参照を追加 -------------------------------
alter table enger.scouts add column if not exists job_id uuid;  -- 対象案件 enger.jobs.id（解決できた場合）
alter table enger.scouts add column if not exists job_no text;  -- 案件ID（営業が入力した表示番号 = jobs.job_no）
create index if not exists scouts_job_idx on enger.scouts (job_id);

-- ---- チャットスレッドにも案件参照(UUID)を補完 -------------------
--   chat_threads には既に job_no(integer) / job_title が存在。お気に入り/応募画面の
--   紐づけ用に UUID(job_id) を追加し、スカウト起点スレッドから案件へ辿れるようにする。
alter table enger.chat_threads add column if not exists job_id uuid;
create index if not exists chat_threads_job_idx on enger.chat_threads (job_id);

-- 確認
-- select engineer_name, agent, job_no, job_id, job_title, status, created_at
-- from enger.scouts order by created_at desc limit 20;
