-- ============================================================
-- 注力フラグ (is_focus) を案件・人材に追加 (冪等)
--   ハートマークで「注力案件 / 注力人材」を指定 → 注力マッチングで使用。
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

alter table enger.jobs       add column if not exists is_focus boolean not null default false;
alter table enger.candidates add column if not exists is_focus boolean not null default false;

create index if not exists jobs_focus_idx       on enger.jobs (is_focus)       where is_focus;
create index if not exists candidates_focus_idx on enger.candidates (is_focus) where is_focus;

-- anon は更新不可（読み取りのみ）。注力トグルはアプリの service role 経由で行う。
