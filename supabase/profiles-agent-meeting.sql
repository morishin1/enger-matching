-- profiles-agent-meeting.sql
-- エージェント面談の完了フラグ（DX「フリーランス登録者一覧」の面談済チェックと連動）。
--   ・DX で面談済にチェック → agent_meeting_done_at に日時をセット
--   ・チェックを外す        → NULL に戻す（＝初期の制限表示に戻る）
--   LP（ENGERフリーランス）側は本列を「案件詳細の全文閲覧・注意文の非表示・応募ボタン解禁」の
--   唯一の判定ソースとして使うこと（enger.engineer_actions の走査より単純・確実・低コスト）。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。

alter table public.profiles add column if not exists agent_meeting_done_at timestamptz;

comment on column public.profiles.agent_meeting_done_at is
  'エージェント面談完了日時（NULL=未面談）。DXの「面談済」チェックと連動し、LPの案件詳細閲覧・応募解禁の判定に使用';

-- 既存データの移行：対応履歴（enger.engineer_actions の action=面談済）が既にある登録者へ反映。
update public.profiles p
   set agent_meeting_done_at = a.done_at
  from (
    select engineer_id::text as engineer_id, min(created_at) as done_at
      from enger.engineer_actions
     where action = '面談済'
     group by engineer_id
  ) a
 where p.id::text = a.engineer_id
   and p.agent_meeting_done_at is null;

-- 確認
-- select id, display_name, agent_meeting_done_at from public.profiles where agent_meeting_done_at is not null limit 20;
