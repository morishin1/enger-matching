-- ============================================================
-- 会社ガード：クローズ理由が会社/人材会社起因のとき「取引注意」を加点する回数カラム。
--   ・caution_count を加点し、一定回数（既定3回）で「要注意会社」バッジ＋次回提案時に警告。
--   ・既存の caution(boolean) は「1回以上注意あり」の意味で併用（後方互換）。
--   中央 Supabase の SQL Editor で実行（冪等）。
-- ============================================================
alter table enger.companies add column if not exists caution_count integer not null default 0;
-- 既存で caution=true のものは最低1回として揃える（任意・冪等）。
update enger.companies set caution_count = greatest(caution_count, 1) where caution = true and caution_count = 0;
create index if not exists companies_caution_count_idx on enger.companies (caution_count) where caution_count > 0;
