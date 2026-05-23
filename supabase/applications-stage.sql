-- ============================================================
-- 応募の選考ステージ — enger.applications に列追加
--   エンジニア(profiles.id)の「応募→面談合格→稼働」を営業(dx)が更新して追跡。
--   稼働まで到達した engineer_id を、紹介(referred_by)と突合して成約判定に使う。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- 応募 / 書類選考 / 面談 / 面談合格 / 稼働 / 見送り
alter table enger.applications add column if not exists stage text not null default '応募';
alter table enger.applications add column if not exists stage_updated_at timestamptz;

create index if not exists applications_stage_idx on enger.applications (stage);
create index if not exists applications_eng_stage_idx on enger.applications (engineer_id, stage);

-- 確認
-- select engineer_name, job_title, stage, stage_updated_at
-- from enger.applications order by stage_updated_at desc nulls last limit 20;
