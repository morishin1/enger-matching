-- 提案ステージを実業務フローに合わせて再編。
--   新ステージ：所属確認 → 提案中 → 面談 → 合格
--
--   旧 → 新 の対応：
--     "提案済"      → "提案中"   （旧:提案直後）
--     "返信待ち"    → "提案中"   （旧:提案直後の別名 or 反応後。いずれも提案中に集約）
--     "提案中"(旧)  → "提案中"
--     "返信あり"    → "提案中"
--     "面談調整"    → "面談"
--     "クロージング中" → "面談"
--     "面談合格"    → "合格"
--   ※ 終了系（見送り/失注/稼働/稼働決定）はそのまま。
--   ※ 新設「所属確認」は今後の新規提案にのみ付く（既存の進行中提案は提案中へ寄せる）。
--
-- UIは normalizeStage() で旧値も自動マップするため、このSQLを実行しなくても表示は崩れない。
-- 集計・生データの整合のため実行を推奨。

begin;

update enger.proposals set stage = '面談', updated_at = now()
 where stage in ('面談調整', 'クロージング中');

update enger.proposals set stage = '合格', updated_at = now()
 where stage = '面談合格';

update enger.proposals set stage = '提案中', updated_at = now()
 where stage in ('提案済', '返信待ち', '返信あり');

-- 旧 "提案中" は新でも "提案中" なので変更不要。

commit;

-- 確認用：
--   select stage, count(*) from enger.proposals group by stage order by stage;
