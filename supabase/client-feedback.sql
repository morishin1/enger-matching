-- ============================================================
-- 企業フィードバック  enger.client_feedback
--   ユーザー企業が「提案された人材」に対して 会いたい/検討中/ミスマッチ を返す。
--   ミスマッチ理由を蓄積し、エージェントの次の提案精度を上げる（ミスマッチ低減）。
-- ============================================================

create table if not exists enger.client_feedback (
  id          uuid primary key default gen_random_uuid(),
  proposal_id uuid references enger.proposals(id) on delete cascade,
  company     text,                            -- 名寄せ用（app_users.company_name と一致）
  verdict     text not null check (verdict in ('want','maybe','mismatch')),
  reason      text,                            -- ミスマッチ理由など
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 1提案につき最新1件（upsert で更新）
create unique index if not exists client_feedback_proposal_uniq on enger.client_feedback (proposal_id);
create index if not exists client_feedback_company_idx on enger.client_feedback (company);

alter table enger.client_feedback enable row level security;
-- 読み書きはサーバ専用(service_role)。エージェント/管理者はサーバ経由で参照。
grant all on enger.client_feedback to service_role;

-- 確認
-- select cf.verdict, cf.reason, p.c_init, p.job_title, cf.company
--   from enger.client_feedback cf join enger.proposals p on p.id = cf.proposal_id
--   order by cf.updated_at desc;
