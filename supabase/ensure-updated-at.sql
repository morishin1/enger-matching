-- candidates / jobs に updated_at 列が無い旧スキーマでも詳細編集が保存できるよう、
-- 列を補填してスキーマキャッシュをリフレッシュする救済マイグレ。
--
-- 症状: 人材詳細/案件詳細で「保存」を押すと
--   Could not find the 'updated_at' column of 'candidates' in the schema cache
-- というエラーが出る。
--
-- 既に列がある環境では IF NOT EXISTS でスキップされるため安全に再実行可能。

alter table enger.candidates
  add column if not exists updated_at timestamptz not null default now();

alter table enger.jobs
  add column if not exists updated_at timestamptz not null default now();

-- PostgREST のスキーマキャッシュを即時リロード（Supabase）。
notify pgrst, 'reload schema';

comment on column enger.candidates.updated_at is '最終更新時刻（編集保存時にアプリ側で更新）';
comment on column enger.jobs.updated_at       is '最終更新時刻（編集保存時にアプリ側で更新）';
