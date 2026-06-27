-- 提案が「面談」フォルダに入ったことを記録する列。
--   ステージ目標ボードの「面談」列を、現在のスナップショットではなく
--   「面談に入ったことのある件数（累計・移動や失注で減算しない・削除のみ減算）」に変更するために使う。
--   ・updateProposalStage で stage が「面談」または「合格」になった時、未設定なら now() をセット。
--   ・既存データは、現在ステージが面談以降（面談/合格/稼働/稼働決定）の提案に対して到達日時を埋め戻す。
alter table enger.proposals add column if not exists meeting_reached_at timestamptz;
create index if not exists proposals_meeting_reached_idx on enger.proposals (meeting_reached_at);

-- 既存データの埋め戻し（現在ステージが面談以降のもの。到達日時は stage_updated_at→updated_at→created_at の順で採用）。
--   ※ 既に面談を通過して失注/見送りになった過去データは現在ステージから判定できないため対象外（取りこぼし）。
update enger.proposals
   set meeting_reached_at = coalesce(stage_updated_at, updated_at, created_at)
 where meeting_reached_at is null
   and stage in ('面談', '合格', '稼働', '稼働決定');

comment on column enger.proposals.meeting_reached_at is '「面談」フォルダに最初に入った日時（面談到達。累計集計用）';
