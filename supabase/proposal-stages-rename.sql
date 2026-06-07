-- 提案ステージ名のリネーム。
--   旧 "返信待ち"（提案直後の意味）→ 新 "提案済"
--   旧 "提案中"（反応後やり取り中の意味）→ 新 "返信待ち"
--   旧 "返信あり"（古い亜種）→ 新 "返信待ち"
--
-- UIは旧値が残っていても normalizeStage() で読み込み時に正規化するので、
-- このSQLを実行しなくても動作はする（が、フィルタ/集計が混在表記で複雑になるので
-- 揃えるのを推奨）。
--
-- 安全のため、トランザクションで段階的に変更：
--   1) "返信あり" → "返信待ち"（直接マップ可能）
--   2) "提案中"   → "返信待ち"
--   3) "返信待ち"（旧値、上で更新されていない元レコード）→ "提案済"
-- ※ 順序を入れ替えると "返信待ち" の意味が混ざるので必ずこの順で実行する。

begin;

-- まず "返信あり" を集約
update enger.proposals
   set stage = '返信待ち', updated_at = now()
 where stage = '返信あり';

-- "提案中" を新 "返信待ち" へ
update enger.proposals
   set stage = '返信待ち', updated_at = now()
 where stage = '提案中';

-- 旧 "返信待ち"（提案直後の意味）を新 "提案済" へ
-- ただし上で更新済みのレコードは updated_at = now() でマークされているので
-- それ以外（stage='返信待ち' かつ 今のトランザクションで更新していない）を対象とする。
update enger.proposals
   set stage = '提案済', updated_at = now()
 where stage = '返信待ち'
   and (updated_at is null or updated_at < now());

commit;

-- 確認用：
--   select stage, count(*) from enger.proposals group by stage order by stage;
