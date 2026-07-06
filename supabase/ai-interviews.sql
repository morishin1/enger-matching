-- ============================================================
-- AI面接（オプション機能）— enger.ai_interviews ＋ 契約フラグ app_users.ai_interview
--   docs/business-dashboard-v2-仕様.md §5「AI面接（オプションモジュール）」の Phase A→B 用。
--   ・Phase A（手動リンク）：企業が候補者ドロワーから「AI面接を依頼」→ 営業が面接URLを手動発行。
--                            依頼は status='requested' として記録し、Slackで社内へ通知。
--   ・Phase B（結果表示）  ：面接結果（score/report_url/video_url/summary）をこの表に保存し、
--                            候補者・応募者ドロワー内に表示（GET /api/public/proposals にも併載）。
--   ・Phase C（将来）      ：AI面接ツールAPI直結（Webフック POST /api/public/ai-interview-webhook）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

-- 契約フラグ：AI面接オプションを契約している企業（アカウント）だけメニュー／依頼ボタンを表示する。
--   §10「契約フラグの持ち方」の当面の実装＝アカウント単位（app_users）。企業単位に寄せる場合は
--   companies 側へ移すが、client アカウントは会社と1:1のため当面はここで足りる。
alter table enger.app_users add column if not exists ai_interview boolean not null default false;
comment on column enger.app_users.ai_interview is 'AI面接オプションの契約フラグ（true でメニュー「AI面接」と依頼ボタンを表示）';

create table if not exists enger.ai_interviews (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null,                 -- 対象の提案（proposals.id）。1提案=1面接
  status        text not null default 'requested', -- requested(依頼済) | scheduled(調整中) | done(完了) | canceled
  score         integer,                       -- 総合評価スコア（0-100 想定）
  report_url    text,                          -- 評価レポートURL
  video_url     text,                          -- 録画URL
  summary       text,                          -- 要約（ドロワー表示用）
  requested_by  text,                          -- 依頼した企業アカウントのメール
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1提案につき1面接（依頼の二重作成を防ぐ）。
create unique index if not exists ai_interviews_proposal_uidx on enger.ai_interviews (proposal_id);
create index if not exists ai_interviews_status_idx on enger.ai_interviews (status);

alter table enger.ai_interviews enable row level security;
drop policy if exists ai_interviews_read on enger.ai_interviews;
create policy ai_interviews_read on enger.ai_interviews for select using (true);
grant select on enger.ai_interviews to anon, authenticated;
grant all on enger.ai_interviews to service_role;

comment on table enger.ai_interviews is 'AI面接の依頼・結果（ENGER business のオプション機能。§5 Phase A→B）';

-- 確認
-- select proposal_id, status, score, created_at from enger.ai_interviews order by created_at desc limit 20;
-- update enger.app_users set ai_interview = true where email = 'client@example.com'; -- 契約企業を有効化する例
