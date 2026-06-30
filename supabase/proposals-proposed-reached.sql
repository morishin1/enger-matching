-- 提案が「提案中」に入ったことを記録する列（管理NO #234②）。
--   ステージ目標ボードの「提案中」列を、現在のスナップショットではなく
--   「提案中に入ったことのある件数（累計・別フォルダ/失注へ移っても減算しない・削除のみ減算）」に変更するために使う。
--   ・updateProposalStage / updateProposalFields で stage が「提案中」以降になった時、未設定なら now() をセット。
--   ・既存データは、現在ステージが提案中以降（提案中/確認中/面談/合格/稼働…）の提案に到達日時を埋め戻す。
alter table enger.proposals add column if not exists proposed_at timestamptz;
create index if not exists proposals_proposed_idx on enger.proposals (proposed_at);

-- 既存データの埋め戻し（到達日時は stage_updated_at→updated_at→created_at の順で採用）。
--   ※ 既に提案中を通過して失注/見送りになった過去データは現在ステージから判定できないため対象外（取りこぼし）。
update enger.proposals
   set proposed_at = coalesce(stage_updated_at, updated_at, created_at)
 where proposed_at is null
   and stage in ('提案中','提案済','返信待ち','返信あり','確認中','面談','面談調整','クロージング中','合格','面談合格','稼働','稼働決定');

comment on column enger.proposals.proposed_at is '「提案中」に最初に入った日時（提案到達。累計集計用）';
