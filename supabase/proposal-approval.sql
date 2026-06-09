-- 提案の承認チェック（提案ボタン押下時に提案者＋承認者を指定し、承認者が後で承認/差戻し）。
--   既存の "所属確認" を先頭ステージにしていたフローの前段に "承認待ち" を追加する。
--   ・approver        : 承認者の氏名（社内メンバー名）。createProposal で必須化。
--   ・approval_status : 'pending' | 'approved' | 'rejected'（既定 pending）
--   ・approved_at     : 承認日時
--   ・approver_email  : 実際に承認した人のメール（誰が承認したか監査）
--   ・reject_reason   : 差戻し理由（任意・差戻し時のみ）
--
--   既存の提案レコードは approval_status を 'approved' として扱う（マイグレ後の互換）。

alter table enger.proposals
  add column if not exists approver        text,
  add column if not exists approval_status text,
  add column if not exists approved_at     timestamptz,
  add column if not exists approver_email  text,
  add column if not exists reject_reason   text;

-- 既存レコードを既承認扱いに（互換）。NULLのままだとUIで「承認待ち」と誤判定するため。
update enger.proposals set approval_status = 'approved' where approval_status is null and stage <> '承認待ち';

-- 承認待ち列を高速に絞り込めるようインデックス
create index if not exists proposals_approval_pending_idx on enger.proposals (created_at desc) where approval_status = 'pending';

comment on column enger.proposals.approver        is '承認者の氏名（社内メンバー）。createProposal時に必須。';
comment on column enger.proposals.approval_status is 'pending=承認待ち / approved=承認済 / rejected=差戻し';
comment on column enger.proposals.approved_at     is '承認日時';
comment on column enger.proposals.approver_email  is '承認操作を行ったユーザーのメール（監査用）';
comment on column enger.proposals.reject_reason   is '差戻し理由';
