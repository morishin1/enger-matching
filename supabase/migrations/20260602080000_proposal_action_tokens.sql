-- 提案に対するクライアント/人材のアクション応答を記録する4カラム追加。
-- 既存の job_notify_status / cand_notify_status（内部ワークフロー用）とは別物。

alter table enger.proposals
  add column if not exists job_action_type  text not null default '未回答',
  add column if not exists job_action_token text unique,
  add column if not exists cand_action_type  text not null default '未回答',
  add column if not exists cand_action_token text unique;

comment on column enger.proposals.job_action_type  is '案件側（企業）のアクション応答：未回答 / 話を進める / 見送り';
comment on column enger.proposals.job_action_token is '案件側メールの応答URLトークン（公開・推測不可）';
comment on column enger.proposals.cand_action_type  is '人材側のアクション応答：未回答 / 話を進める / 見送り';
comment on column enger.proposals.cand_action_token is '人材側メールの応答URLトークン（公開・推測不可）';
