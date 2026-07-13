-- #368：案件に「フリーランスの応募」欄を追加。
--   値は "NG"（フリーランスの応募NG）または NULL（空欄＝制限なし）。
--   案件詳細ドロワー／案件編集モーダル／案件管理ページのインライン選択から更新される。
--   中央 Supabase の SQL Editor で実行（何度でも安全）。
alter table enger.jobs add column if not exists freelance_ng text;
comment on column enger.jobs.freelance_ng is 'フリーランスの応募（#368）。"NG" または NULL（空欄＝制限なし）。';
