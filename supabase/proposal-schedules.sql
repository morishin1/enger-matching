-- ============================================================
-- 提案の予約配信（マッチング：チェック選択 → 日時指定 → 自動配信）
--   マッチング画面で選択したペアを scheduled_at に自動で提案登録し、
--   案件側・人材側へ提案メール（話を進める／見送りボタン付き）を配信する。
--   実行は /api/cron/proposal-schedules（GitHub Actions から15分毎に起動）。
--   中央 Supabase の SQL Editor で実行（何度実行しても安全）。
-- ============================================================

create table if not exists enger.proposal_schedules (
  id               uuid primary key default gen_random_uuid(),
  scheduled_at     timestamptz not null,             -- 配信予定日時（この時刻以降の最初のバッチで実行）
  status           text not null default 'pending',  -- pending / processing / done / canceled / error
  pairs            jsonb not null default '[]',      -- [{job_no, candidate_no, score}]
  created_by       text,                             -- 予約者（提案者として proposals に記録される）
  created_by_email text,                             -- 予約者メール（配信メールの CC・監査用）
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  processed_at     timestamptz,                      -- 全ペア処理完了日時
  result           jsonb                             -- ペア毎の実行結果（再実行時は未処理ペアだけ続きから）
);

create index if not exists proposal_schedules_due_idx
  on enger.proposal_schedules (status, scheduled_at);

comment on table enger.proposal_schedules is '提案の予約配信。マッチングで選択したペアを指定日時に自動提案（記録＋メール配信）する。';
comment on column enger.proposal_schedules.pairs is '配信対象 [{job_no, candidate_no, score}]';
comment on column enger.proposal_schedules.result is 'ペア毎の結果 {"<job_no>-<candidate_no>": {ok, proposalId, mailJob, mailCand, error}}';

-- 確認
-- select id, scheduled_at, status, jsonb_array_length(pairs) as pair_count, created_by from enger.proposal_schedules order by scheduled_at desc limit 20;
