-- 提案メモのカテゴリ刷新（名称＋並び替え）。
--   旧: 連絡記録 / 重要事項 / 内部メモ / クライアント対応 / 人材対応
--   新: 連絡記録 / 当社→案件側 / 案件側→当社 / 当社→人材側 / 人材側→当社
--
-- 移行ルール:
--   ・重要事項・内部メモ … 過去ぶんは「連絡記録」へ集約（新カテゴリの方向ラベルとは意味が異なるため）
--   ・クライアント対応 … 「案件側→当社」へ
--   ・人材対応       … 「人材側→当社」へ
-- ※ アプリ側でも normalizeMemoCategory() で同じ変換を吸収するため、未適用でも表示は崩れない。
--   このマイグレーションは保存値そのものをそろえる目的（再変換不要にする）。
update enger.proposal_memos set category = '連絡記録'   where category in ('重要事項', '内部メモ');
update enger.proposal_memos set category = '案件側→当社' where category = 'クライアント対応';
update enger.proposal_memos set category = '人材側→当社' where category = '人材対応';
