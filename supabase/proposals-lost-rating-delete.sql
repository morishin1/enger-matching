-- ============================================================
-- 提案：失注時の★評価（人材・案件）＋ 削除の申請/承認フロー（冪等）
--   ・cand_rating / job_rating : 失注時に付ける ★1〜5 評価
--       - job_rating は企業評価に連動（企業の案件★平均として集計）
--       - cand_rating は人材側の評価として保持
--   ・delete_requested_* : 提案削除の「申請→承認」フロー
--       - 管理者以外が削除する場合は理由を書いて申請（pending）
--       - 管理者が承認すると実削除 / 却下で申請取消
--       - 管理者自身の削除は申請＝即承認（即削除）
-- ============================================================
alter table enger.proposals
  add column if not exists cand_rating         int,         -- 失注時 人材★(1-5)
  add column if not exists job_rating          int,         -- 失注時 案件★(1-5)
  add column if not exists delete_requested_at timestamptz, -- 削除申請日時（pending の目印）
  add column if not exists delete_reason       text,        -- 削除理由
  add column if not exists delete_requested_by text;        -- 削除申請者（氏名/メール）

-- 削除申請中の提案を素早く絞り込めるように
create index if not exists proposals_delete_pending_idx
  on enger.proposals (delete_requested_at)
  where delete_requested_at is not null;

comment on column enger.proposals.cand_rating         is '失注時の人材★評価(1-5)';
comment on column enger.proposals.job_rating          is '失注時の案件★評価(1-5)。企業評価(案件★平均)に連動';
comment on column enger.proposals.delete_requested_at is '削除申請日時（NULLでない=承認待ち）';
comment on column enger.proposals.delete_reason       is '削除理由（申請時必須）';
comment on column enger.proposals.delete_requested_by is '削除申請者（氏名 or メール）';
