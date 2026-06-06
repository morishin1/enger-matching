-- 案件の鮮度ガード用カラム。
--   last_confirmed_at : 「この案件はまだ募集中」と最後に確認した日時。
--     - マッチングの鮮度判定は coalesce(last_confirmed_at, created_at) を基準にする。
--     - 担当が「まだ募集中？」を確認したら now() に更新 → 鮮度がリセットされ再び候補に出る。
--   ※ 充足（決まった案件）は proposals の stage in ('稼働決定','稼働') から動的に判定するため
--     ここには列を持たない（運用の二重管理を避ける）。必要なら status を手動で終了系にしてもよい。

alter table enger.jobs
  add column if not exists last_confirmed_at timestamptz;

create index if not exists jobs_last_confirmed_idx on enger.jobs (last_confirmed_at);

comment on column enger.jobs.last_confirmed_at is '最終在否確認日時。マッチングの鮮度基準（無ければ created_at にフォールバック）';

-- 既存案件は created_at を初期値にしておくと、過去案件が一斉に「新しい」扱いにならない。
-- （任意・1回だけ実行）
--   update enger.jobs set last_confirmed_at = created_at where last_confirmed_at is null;
