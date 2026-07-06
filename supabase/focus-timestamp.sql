-- 注力(♥)に登録した日時。注力ボード（マッチング → 注力マッチング）の一覧に
-- 「注力登録日」を表示するために使う（#316③）。
--   ・注力ON（is_focus=true）にした時に now() をセットする。
--   ・一度外して（is_focus=false）再度ONにした時も now() で上書きする
--     ＝常に「最新の注力開始日」を表示する（要望どおり）。
--   ・OFFにした時は変更しない（次にONにした時にまた now() で更新される）。
-- ※ 未適用でもアプリは動く（fail-soft）。その環境では登録日が「—」で表示される。

alter table enger.jobs       add column if not exists focused_at timestamptz;
alter table enger.candidates add column if not exists focused_at timestamptz;

create index if not exists jobs_focused_at_idx       on enger.jobs (focused_at);
create index if not exists candidates_focused_at_idx on enger.candidates (focused_at);

comment on column enger.jobs.focused_at       is '注力(♥)にした日時。注力ONで now() をセット/更新（#316）。';
comment on column enger.candidates.focused_at is '注力(♥)にした日時。注力ONで now() をセット/更新（#316）。';

-- 既に注力ONの既存行は日付不明のまま（NULL＝表示「—」）で構わない。
-- 暫定で埋めたい場合のみ、下記を任意で1回実行してよい（更新日時などで代用）：
--   update enger.jobs       set focused_at = coalesce(last_confirmed_at, created_at) where is_focus = true and focused_at is null;
--   update enger.candidates set focused_at = created_at where is_focus = true and focused_at is null;
