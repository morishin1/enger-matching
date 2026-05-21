-- ============================================================
-- ENGER v2 Matching — enger スキーマ拡張 (冪等)
--   人材(candidates) / 提案・進捗(proposals) / 稼働(engagements) / 企業(companies)
--   jobs は既存(2,095件)。中央 Supabase の SQL Editor で実行。
--   適用後: Settings → API → Exposed schemas に enger があること(設定済み)
-- ============================================================

create schema if not exists enger;
grant usage on schema enger to anon, authenticated, service_role;

-- ---------- 企業 ----------
create table if not exists enger.companies (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name          text not null,
  initials      text,
  tier          text default 'C',          -- A / B / C
  industry      text,
  active_jobs   int default 0,
  last_deals    int default 0,
  total_revenue text,
  owner         text,
  owner_init    text,
  status        text default '新規',        -- 主要 / 拡大中 / 新規 / 休眠
  last_activity text,
  relation      int default 50,
  color         text default '#0095D9',
  note          text,
  source_csv    text,
  created_at    timestamptz not null default now()
);

-- ---------- 人材 (CSV で UP) ----------
create table if not exists enger.candidates (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  initials    text,
  title       text,
  exp         text,
  company     text,                          -- 所属(フリーランス/パートナー等)
  rate        text,                          -- 表示用 "¥90万"
  rate_num    numeric,                        -- 数値(万円)
  avail       text,
  location    text,
  skills      text[] not null default '{}',
  score       int default 0,
  why         text[] not null default '{}',
  status      text default '提案可',
  saved       boolean not null default false,
  source_csv  text,
  imported_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists candidates_skills_idx on enger.candidates using gin (skills);

-- ---------- 提案・進捗 (マッチング → 提案 → 面談 → 成約) ----------
create table if not exists enger.proposals (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  job_id         uuid references enger.jobs(id) on delete set null,
  candidate_id   uuid references enger.candidates(id) on delete set null,
  stage          text not null default '新規提案',  -- 新規提案/提案中/面談調整/条件交渉/成約間近/成約/失注
  job_title      text,
  company        text,
  candidate_name text,
  c_init         text,
  rate           text,
  score          int,
  owner          text,
  owner_init     text,
  due            text,
  due_t          text,                          -- '' / warn / danger
  days_in        int default 0,
  next_action    text,
  ai             boolean default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists proposals_stage_idx on enger.proposals (stage);

-- ---------- 稼働 (成約後の稼働管理) ----------
create table if not exists enger.engagements (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid references enger.proposals(id) on delete set null,
  job_title      text,
  company        text,
  candidate_name text,
  monthly_rate   numeric,
  start_date     date,
  end_date       date,
  status         text default '稼働中',         -- 予定 / 稼働中 / 終了
  created_at     timestamptz not null default now()
);

-- ---------- RLS: 公開読み取り(社内ツール前提) / 書き込みは service_role ----------
do $$
declare t text;
begin
  foreach t in array array['companies','candidates','proposals','engagements'] loop
    execute format('alter table enger.%I enable row level security', t);
    execute format('drop policy if exists %I_read on enger.%I', t, t);
    execute format('create policy %I_read on enger.%I for select using (true)', t, t);
  end loop;
end $$;

grant select on enger.companies, enger.candidates, enger.proposals, enger.engagements to anon, authenticated;
grant all on enger.companies, enger.candidates, enger.proposals, enger.engagements to service_role;

-- 確認
-- select table_name from information_schema.tables where table_schema='enger' order by table_name;
