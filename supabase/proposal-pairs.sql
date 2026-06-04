-- ============================================================
-- 提案を「2人1組」に: enger.proposals に partner（パートナー）を追加 (冪等)
--   2人1組 = proposer（提案者）＋ partner（パートナー）。
--   closer（クロージング担当）は 2人のうちどちらか（提案後にペアで相談して決定）。
--   インサイド/アウトサイドの区分に関係なく、全員が提案・クロージング・打合せを担当する。
--   中央 Supabase の SQL Editor で実行（何度でも安全）。
-- ============================================================

alter table enger.proposals add column if not exists partner text;  -- 2人1組のパートナー

-- 確認
-- select proposer, partner, closer, stage from enger.proposals where proposer is not null limit 20;
