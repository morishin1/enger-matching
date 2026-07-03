-- ============================================================
-- 見送り直前ステージ（enger.proposals.pre_lost_stage）— #291
--   「提案ボードに戻す」ボタンで、見送り(失注)になる直前の状態へ正確に復元できるようにする。
--   ・見送りにする瞬間（updateProposalFields / ProposalBoard・ProposalDetailModal の見送り操作）に
--     その時点の stage をここへ保存する。
--   ・見送り以外へステージが動いたとき（提案ボードに戻す含む）は自動でクリアする。
--   ・この列が無い/空の古い失注レコードは、復元時に従来どおり「所属確認」へ戻す
--     フォールバックが actions.ts 側にあるため、本マイグレーション未実行でも動作は壊れない。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.proposals add column if not exists pre_lost_stage text;

comment on column enger.proposals.pre_lost_stage is
  '見送り(失注)になる直前の stage 値。「提案ボードに戻す」でここへ復元し、その後 null に戻す。';

-- 確認
-- select id, stage, pre_lost_stage, lost_phase from enger.proposals where stage in ('見送り','失注') order by stage_updated_at desc limit 20;
