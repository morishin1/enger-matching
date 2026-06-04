-- ============================================================
-- 提案ステージの「未対応」→「返信待ち」に改名（冪等）
--   ボードに記録した直後 = 提案メールは送信済み・先方の反応待ち、という意図を
--   正しく表すラベルに改める。
--   既存データを一括 update。新規 insert の初期値はコード側で対応。
-- ============================================================

update enger.proposals
   set stage = '返信待ち', updated_at = coalesce(updated_at, now())
 where stage = '未対応';

-- 確認
-- select stage, count(*) from enger.proposals group by stage order by 1;
