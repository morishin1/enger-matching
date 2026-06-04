-- ============================================================
-- ENGER Matching — Full Local Schema Migration
-- ============================================================

-- ---- Schema + grants ----
create schema if not exists enger;
grant usage on schema enger to anon, authenticated, service_role;

-- ============================================================
-- enger.jobs (base table — referenced by proposals)
-- ============================================================
create table if not exists enger.jobs (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  role_label      text,
  skills          text[] not null default '{}',
  salary_min      numeric,
  salary_max      numeric,
  remote_type     text,
  client_name     text,
  flow_note       text,
  detail          text,
  work_location   text,
  start_date      text,
  status          text default '募集中',
  is_published    boolean not null default false,
  created_at      timestamptz not null default now()
);
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='enger' and table_name='jobs' and column_name='job_no'
  ) then
    alter table enger.jobs add column job_no bigint generated always as identity;
  end if;
end $$;
create unique index if not exists jobs_no_uniq on enger.jobs (job_no);
create index if not exists jobs_published_idx on enger.jobs (is_published);
create index if not exists jobs_skills_idx on enger.jobs using gin (skills);

alter table enger.jobs enable row level security;
drop policy if exists jobs_read on enger.jobs;
create policy jobs_read on enger.jobs for select using (true);
grant select on enger.jobs to anon, authenticated;
grant all on enger.jobs to service_role;

-- ============================================================
-- schema-matching.sql: companies, candidates, proposals, engagements
-- ============================================================

-- ---------- 企業 ----------
create table if not exists enger.companies (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name          text not null,
  initials      text,
  tier          text default 'C',
  industry      text,
  active_jobs   int default 0,
  last_deals    int default 0,
  total_revenue text,
  owner         text,
  owner_init    text,
  status        text default '新規',
  last_activity text,
  relation      int default 50,
  color         text default '#0095D9',
  note          text,
  source_csv    text,
  created_at    timestamptz not null default now()
);

-- ---------- 人材 ----------
create table if not exists enger.candidates (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  initials    text,
  title       text,
  exp         text,
  company     text,
  rate        text,
  rate_num    numeric,
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

-- ---------- 提案・進捗 ----------
create table if not exists enger.proposals (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  job_id         uuid references enger.jobs(id) on delete set null,
  candidate_id   uuid references enger.candidates(id) on delete set null,
  stage          text not null default '新規提案',
  job_title      text,
  company        text,
  candidate_name text,
  c_init         text,
  rate           text,
  score          int,
  owner          text,
  owner_init     text,
  due            text,
  due_t          text,
  days_in        int default 0,
  next_action    text,
  ai             boolean default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists proposals_stage_idx on enger.proposals (stage);

-- ---------- 稼働 ----------
create table if not exists enger.engagements (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid references enger.proposals(id) on delete set null,
  job_title      text,
  company        text,
  candidate_name text,
  monthly_rate   numeric,
  start_date     date,
  end_date       date,
  status         text default '稼働中',
  created_at     timestamptz not null default now()
);

-- RLS
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

-- ============================================================
-- candidates-columns.sql
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='enger' and table_name='candidates' and column_name='candidate_no'
  ) then
    alter table enger.candidates add column candidate_no bigint generated always as identity;
  end if;
end $$;
create unique index if not exists candidates_no_uniq on enger.candidates (candidate_no);

alter table enger.candidates add column if not exists salary_min     numeric;
alter table enger.candidates add column if not exists salary_max     numeric;
alter table enger.candidates add column if not exists age_band       text;
alter table enger.candidates add column if not exists nationality    text;
alter table enger.candidates add column if not exists skill_level    text;
alter table enger.candidates add column if not exists work_days      text;
alter table enger.candidates add column if not exists remote_pref    text;
alter table enger.candidates add column if not exists japanese_level text;
alter table enger.candidates add column if not exists comm           text;
alter table enger.candidates add column if not exists affiliation    text;
alter table enger.candidates add column if not exists source_company text;
alter table enger.candidates add column if not exists start_date     date;
alter table enger.candidates add column if not exists note           text;

-- ============================================================
-- email-columns.sql
-- ============================================================
alter table enger.jobs       add column if not exists contact_email   text;
alter table enger.jobs       add column if not exists contact_name    text;
alter table enger.jobs       add column if not exists source_mail_url text;

alter table enger.candidates add column if not exists email           text;
alter table enger.candidates add column if not exists contact_email   text;
alter table enger.candidates add column if not exists source_mail_url text;

-- ============================================================
-- candidates-skillsheet.sql
-- ============================================================
alter table enger.candidates add column if not exists skill_sheet_url text;

-- ============================================================
-- focus-flag.sql
-- ============================================================
alter table enger.jobs       add column if not exists is_focus boolean not null default false;
alter table enger.candidates add column if not exists is_focus boolean not null default false;

create index if not exists jobs_focus_idx       on enger.jobs (is_focus)       where is_focus;
create index if not exists candidates_focus_idx on enger.candidates (is_focus) where is_focus;

-- ============================================================
-- client-jobs.sql
-- ============================================================
alter table enger.jobs add column if not exists contract_types   text[] not null default '{}';
alter table enger.jobs add column if not exists posted_by_client boolean not null default false;
alter table enger.jobs add column if not exists review_status    text;
alter table enger.jobs add column if not exists posted_by_email  text;

create index if not exists jobs_review_idx on enger.jobs (review_status) where review_status is not null;

-- ============================================================
-- sales-roles.sql
-- ============================================================
alter table enger.jobs add column if not exists outside_owner text;
create index if not exists jobs_outside_owner_idx on enger.jobs (outside_owner);

-- ============================================================
-- accounts.sql (app_users)
-- ============================================================
create table if not exists enger.app_users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  name         text,
  role         text not null default 'client'  check (role   in ('admin','agent','client')),
  status       text not null default 'pending' check (status in ('pending','active','disabled')),
  company_name text,
  note         text,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);
alter table enger.app_users add column if not exists company_name text;
alter table enger.app_users add column if not exists note         text;
alter table enger.app_users add column if not exists approved_at  timestamptz;

create index if not exists app_users_email_idx  on enger.app_users (lower(email));
create index if not exists app_users_status_idx on enger.app_users (status);

alter table enger.app_users enable row level security;
drop policy if exists app_users_admin_all on enger.app_users;
grant all on enger.app_users to service_role;

-- ============================================================
-- account-functions.sql
-- ============================================================
alter table enger.app_users add column if not exists functions text[] not null default '{}';

-- ============================================================
-- staff.sql
-- ============================================================
create table if not exists enger.staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  email       text,
  is_proposer boolean not null default true,
  is_closer   boolean not null default false,
  sort        int default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table enger.staff add column if not exists email    text;
alter table enger.staff add column if not exists position text;

alter table enger.staff enable row level security;
drop policy if exists staff_read on enger.staff;
create policy staff_read on enger.staff for select using (true);
grant select on enger.staff to anon, authenticated;
grant all on enger.staff to service_role;

-- ============================================================
-- notifications.sql
-- ============================================================
create table if not exists enger.notifications (
  id         uuid primary key default gen_random_uuid(),
  recipient  text not null,
  title      text not null,
  body       text,
  kind       text default 'feedback',
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_recipient_idx on enger.notifications (recipient, created_at desc);

alter table enger.notifications enable row level security;
grant all on enger.notifications to service_role;
grant select on enger.notifications to anon, authenticated;
drop policy if exists notifications_read on enger.notifications;
create policy notifications_read on enger.notifications for select using (true);

-- ============================================================
-- app-settings.sql
-- ============================================================
create table if not exists enger.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table enger.app_settings enable row level security;
grant all on enger.app_settings to service_role;
grant select on enger.app_settings to anon, authenticated;
drop policy if exists app_settings_read on enger.app_settings;
create policy app_settings_read on enger.app_settings for select using (true);

-- ============================================================
-- ai-usage.sql + ai-usage-provider.sql
-- ============================================================
create table if not exists enger.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  feature       text not null,
  model         text,
  input_tokens  int default 0,
  output_tokens int default 0,
  cost_usd      numeric default 0,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on enger.ai_usage (created_at);

alter table enger.ai_usage enable row level security;
drop policy if exists ai_usage_read on enger.ai_usage;
create policy ai_usage_read on enger.ai_usage for select using (true);
grant select on enger.ai_usage to anon, authenticated;
grant all on enger.ai_usage to service_role;

alter table enger.ai_usage add column if not exists provider text default 'internal';

-- ============================================================
-- applications-favorites.sql
-- ============================================================
create table if not exists enger.applications (
  id            uuid primary key default gen_random_uuid(),
  engineer_id   uuid not null,
  engineer_name text,
  job_id        uuid,
  job_no        text,
  job_title     text,
  message       text,
  status        text not null default 'applied',
  created_at    timestamptz not null default now()
);
create unique index if not exists applications_uniq    on enger.applications (engineer_id, job_id);
create index        if not exists applications_job_idx on enger.applications (job_id, created_at desc);
create index        if not exists applications_eng_idx on enger.applications (engineer_id, created_at desc);

alter table enger.applications enable row level security;
drop policy if exists applications_read on enger.applications;
create policy applications_read on enger.applications for select using (true);
grant select on enger.applications to anon, authenticated;
grant all on enger.applications to service_role;

create table if not exists enger.job_favorites (
  engineer_id uuid not null,
  job_id      uuid not null,
  created_at  timestamptz not null default now(),
  primary key (engineer_id, job_id)
);
alter table enger.job_favorites enable row level security;
drop policy if exists job_favorites_own on enger.job_favorites;
create policy job_favorites_own on enger.job_favorites
  for all using (auth.uid() = engineer_id) with check (auth.uid() = engineer_id);
grant select, insert, delete on enger.job_favorites to authenticated;
grant all on enger.job_favorites to service_role;

-- ============================================================
-- billing.sql
-- ============================================================
create table if not exists enger.billing_tasks (
  id                uuid primary key default gen_random_uuid(),
  engagement_id     uuid references enger.engagements(id) on delete cascade,
  period            text not null,
  attendance_status text default '未',
  attendance_hours  numeric,
  attendance_file   text,
  invoice_status    text default '未',
  invoice_amount    numeric,
  invoice_file      text,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists billing_tasks_uniq       on enger.billing_tasks (engagement_id, period);
create index        if not exists billing_tasks_period_idx on enger.billing_tasks (period);

alter table enger.billing_tasks enable row level security;
grant all on enger.billing_tasks to service_role;

-- ============================================================
-- agent-ops.sql
-- ============================================================
alter table enger.proposals  add column if not exists meeting_date   date;
alter table enger.proposals  add column if not exists meeting_status text;
alter table enger.candidates add column if not exists last_contact_at date;
alter table enger.engagements add column if not exists cost          numeric;
alter table enger.engagements add column if not exists renewal_due   date;
alter table enger.engagements add column if not exists renewal_status text;

create index if not exists proposals_meeting_idx on enger.proposals (meeting_date);
create index if not exists engagements_end_idx   on enger.engagements (end_date);

-- ============================================================
-- engagement-ops.sql
-- ============================================================
alter table enger.engagements add column if not exists affiliation     text;
alter table enger.engagements add column if not exists settle_min      numeric;
alter table enger.engagements add column if not exists settle_max      numeric;
alter table enger.engagements add column if not exists work_hours      numeric;
alter table enger.engagements add column if not exists contract_status text;
alter table enger.engagements add column if not exists po_status       text;
alter table enger.engagements add column if not exists renewal_due     date;
alter table enger.engagements add column if not exists renewal_status  text;

create index if not exists engagements_renewal_idx on enger.engagements (renewal_due);

-- ============================================================
-- proposals-ops.sql
-- ============================================================
alter table enger.proposals add column if not exists caller_status  text;
alter table enger.proposals add column if not exists proposer       text;
alter table enger.proposals add column if not exists closer         text;
alter table enger.proposals add column if not exists client_contact text;
alter table enger.proposals add column if not exists lost_reason    text;
alter table enger.proposals add column if not exists lost_phase     text;
alter table enger.proposals add column if not exists ai_match       numeric;
alter table enger.proposals add column if not exists called_at      date;
alter table enger.proposals add column if not exists proposed_at    date;

create index if not exists proposals_caller_idx on enger.proposals (caller_status);

-- ============================================================
-- proposals-unique.sql
-- ============================================================
create unique index if not exists proposals_job_cand_uq
  on enger.proposals (job_id, candidate_id);

-- ============================================================
-- quality.sql
-- ============================================================
alter table enger.proposals add column if not exists disqualified boolean not null default false;
alter table enger.proposals add column if not exists dq_reason    text;
alter table enger.proposals add column if not exists dq_at        timestamptz;
create index if not exists proposals_dq_idx on enger.proposals (disqualified);

create table if not exists enger.quality_rules (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  label      text not null,
  enabled    boolean not null default true,
  threshold  numeric,
  note       text,
  sort       int default 0,
  created_at timestamptz not null default now()
);
alter table enger.quality_rules enable row level security;
grant all on enger.quality_rules to service_role;
grant select on enger.quality_rules to anon, authenticated;
drop policy if exists quality_rules_read on enger.quality_rules;
create policy quality_rules_read on enger.quality_rules for select using (true);

-- ============================================================
-- scouts.sql
-- ============================================================
create table if not exists enger.scouts (
  id            uuid primary key default gen_random_uuid(),
  engineer_id   uuid not null,
  engineer_name text,
  agent         text,
  job_title     text,
  message       text not null,
  status        text not null default 'sent',
  reply         text,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  replied_at    timestamptz
);
create index if not exists scouts_engineer_idx on enger.scouts (engineer_id, created_at desc);

alter table enger.scouts enable row level security;
drop policy if exists scouts_read on enger.scouts;
create policy scouts_read on enger.scouts for select using (true);
drop policy if exists scouts_update_own on enger.scouts;
create policy scouts_update_own on enger.scouts
  for update using (auth.uid() = engineer_id) with check (auth.uid() = engineer_id);
grant select on enger.scouts to anon, authenticated;
grant update on enger.scouts to authenticated;
grant all on enger.scouts to service_role;

-- ============================================================
-- talent-interest.sql
-- ============================================================
create table if not exists enger.talent_interest (
  id           uuid primary key default gen_random_uuid(),
  company      text not null,
  kind         text not null,
  candidate_id uuid,
  engineer_id  uuid,
  label        text,
  note         text,
  status       text not null default 'new',
  created_at   timestamptz not null default now()
);
create index        if not exists talent_interest_company_idx on enger.talent_interest (company, created_at desc);
create unique index if not exists talent_interest_uniq        on enger.talent_interest (company, kind, coalesce(candidate_id, engineer_id));

alter table enger.talent_interest enable row level security;
drop policy if exists talent_interest_read on enger.talent_interest;
create policy talent_interest_read on enger.talent_interest for select using (true);
grant select on enger.talent_interest to anon, authenticated;
grant all on enger.talent_interest to service_role;

-- ============================================================
-- meetings.sql + meetings-followup.sql
-- ============================================================
create table if not exists enger.meetings (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  company_name    text,
  meeting_date    date,
  their_contact   text,
  our_owner       text,
  new_or_existing text,
  relation_status text,
  fb_sentiment    text,
  ai_summary      text,
  enger_fb        text,
  hit_points      text,
  miss_points     text,
  needs           text,
  strategy        text,
  next_action_us  text,
  next_action_them text,
  competitors     text[] default '{}',
  competitor_detail text,
  tags            text[] default '{}',
  transcript_url  text,
  publishable     text,
  created_at      timestamptz not null default now()
);
create index if not exists meetings_company_idx on enger.meetings (company_name);
create index if not exists meetings_date_idx    on enger.meetings (meeting_date);

alter table enger.meetings enable row level security;
drop policy if exists meetings_read on enger.meetings;
create policy meetings_read on enger.meetings for select using (true);
grant select on enger.meetings to anon, authenticated;
grant all on enger.meetings to service_role;

alter table enger.meetings add column if not exists follow_up_date date;
alter table enger.meetings add column if not exists follow_done    boolean not null default false;
create index if not exists meetings_followup_idx on enger.meetings (follow_up_date) where follow_done = false;

-- ============================================================
-- daily-reports.sql
-- ============================================================
create table if not exists enger.daily_reports (
  id          uuid primary key default gen_random_uuid(),
  author      text not null,
  team        text,
  report_date date not null default current_date,
  did         text[] not null default '{}',
  did_note    text,
  learned     text,
  next_action text,
  mood        text,
  metrics     jsonb,
  ai_comment  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table enger.daily_reports add column if not exists self_check jsonb;
alter table enger.daily_reports add column if not exists good       text;
alter table enger.daily_reports add column if not exists problem    text;
alter table enger.daily_reports add column if not exists cause      text;
alter table enger.daily_reports add column if not exists outputs    numeric;
alter table enger.daily_reports add column if not exists contacts   numeric;

create unique index if not exists daily_reports_uniq     on enger.daily_reports (author, report_date);
create index        if not exists daily_reports_date_idx on enger.daily_reports (report_date desc);

alter table enger.daily_reports enable row level security;
grant all on enger.daily_reports to service_role;
grant select on enger.daily_reports to anon, authenticated;
drop policy if exists daily_reports_read on enger.daily_reports;
create policy daily_reports_read on enger.daily_reports for select using (true);

-- ============================================================
-- document-tasks.sql
-- ============================================================
create table if not exists enger.document_tasks (
  id            uuid primary key default gen_random_uuid(),
  party         text not null default '上位',
  counterparty  text,
  subject       text,
  doc_type      text not null default '契約書',
  due_date      date,
  status        text not null default '未送付',
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists document_tasks_due_idx    on enger.document_tasks (due_date);
create index if not exists document_tasks_status_idx on enger.document_tasks (status);

alter table enger.document_tasks enable row level security;
drop policy if exists document_tasks_read on enger.document_tasks;
create policy document_tasks_read on enger.document_tasks for select using (true);
grant select on enger.document_tasks to anon, authenticated;
grant all    on enger.document_tasks to service_role;

-- ============================================================
-- contact-messages.sql
-- ============================================================
create table if not exists enger.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  company    text,
  name       text,
  email      text,
  phone      text,
  topic      text,
  role       text,
  message    text,
  source     text,
  status     text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_created_idx on enger.contact_messages (created_at desc);
create index if not exists contact_messages_status_idx  on enger.contact_messages (status);

alter table enger.contact_messages enable row level security;
drop policy if exists contact_messages_read on enger.contact_messages;
create policy contact_messages_read on enger.contact_messages for select using (true);
grant select on enger.contact_messages to anon, authenticated;
grant all on enger.contact_messages to service_role;

-- ============================================================
-- companies-extend.sql + companies-followup.sql
-- ============================================================
alter table enger.companies add column if not exists contact_email      text;
alter table enger.companies add column if not exists contact_name       text;
alter table enger.companies add column if not exists phone              text;
alter table enger.companies add column if not exists website            text;
alter table enger.companies add column if not exists address            text;
alter table enger.companies add column if not exists owner_staff        text;
alter table enger.companies add column if not exists last_contacted_at  timestamptz;

create unique index if not exists companies_name_uniq on enger.companies (name);

-- ============================================================
-- company-profiles.sql
-- ============================================================
create table if not exists enger.company_profiles (
  company       text primary key,
  mission       text,
  culture       text,
  ideal_persona text,
  appeal        text,
  website       text,
  updated_at    timestamptz not null default now()
);
alter table enger.company_profiles enable row level security;
drop policy if exists company_profiles_read on enger.company_profiles;
create policy company_profiles_read on enger.company_profiles for select using (true);
grant select on enger.company_profiles to anon, authenticated;
grant all on enger.company_profiles to service_role;

-- ============================================================
-- people-rank.sql
-- ============================================================
alter table enger.candidates add column if not exists rank text;

-- ============================================================
-- board-link.sql
-- ============================================================
alter table enger.engagements add column if not exists board_project_id text;
create index if not exists engagements_board_project_idx on enger.engagements (board_project_id);

-- ============================================================
-- pr-posts.sql
-- ============================================================
create table if not exists enger.pr_posts (
  id         uuid primary key default gen_random_uuid(),
  operator   text,
  kind       text,
  created_at timestamptz not null default now()
);
create index if not exists pr_posts_operator_idx on enger.pr_posts (operator, created_at desc);
create index if not exists pr_posts_created_idx  on enger.pr_posts (created_at desc);

alter table enger.pr_posts enable row level security;
grant all on enger.pr_posts to service_role;
grant select on enger.pr_posts to anon, authenticated;
drop policy if exists pr_posts_read on enger.pr_posts;
create policy pr_posts_read on enger.pr_posts for select using (true);

-- ============================================================
-- engineer-actions.sql
-- ============================================================
create table if not exists enger.engineer_actions (
  id            uuid primary key default gen_random_uuid(),
  engineer_id   uuid not null,
  engineer_name text,
  action        text not null,
  note          text,
  operator      text,
  created_at    timestamptz not null default now()
);
create index if not exists engineer_actions_eng_idx on enger.engineer_actions (engineer_id, created_at desc);

alter table enger.engineer_actions enable row level security;
drop policy if exists engineer_actions_read on enger.engineer_actions;
create policy engineer_actions_read on enger.engineer_actions for select using (true);
grant select on enger.engineer_actions to anon, authenticated;
grant all on enger.engineer_actions to service_role;

-- ============================================================
-- applications-stage.sql
-- ============================================================
alter table enger.applications add column if not exists stage            text not null default '応募';
alter table enger.applications add column if not exists stage_updated_at timestamptz;

create index if not exists applications_stage_idx     on enger.applications (stage);
create index if not exists applications_eng_stage_idx on enger.applications (engineer_id, stage);

-- ============================================================
-- engagement-rate-changes.sql
-- ============================================================
create table if not exists enger.engagement_rate_changes (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references enger.engagements(id) on delete cascade,
  effective_date date not null,
  old_rate       numeric,
  new_rate       numeric not null,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists engagement_rate_changes_eng_idx on enger.engagement_rate_changes (engagement_id, effective_date desc);

alter table enger.engagement_rate_changes enable row level security;
drop policy if exists engagement_rate_changes_read on enger.engagement_rate_changes;
create policy engagement_rate_changes_read on enger.engagement_rate_changes for select using (true);
grant select on enger.engagement_rate_changes to anon, authenticated;
grant all    on enger.engagement_rate_changes to service_role;

-- ============================================================
-- proposal-pairs.sql
-- ============================================================
alter table enger.proposals add column if not exists partner text;

-- ============================================================
-- stats-rpc.sql
-- ============================================================
create or replace function enger.matching_stats()
returns json
language sql
stable
as $$
  select json_build_object(
    'jobs_total',       (select count(*) from enger.jobs where is_published),
    'jobs_proposable',  (select count(*) from enger.jobs j
                          where j.is_published
                            and coalesce(j.status,'募集中') = '募集中'
                            and array_length(j.skills,1) is not null
                            and exists (select 1 from enger.candidates c where c.skills && j.skills)),
    'jobs_new7',        (select count(*) from enger.jobs
                          where is_published and created_at >= now() - interval '7 days'),
    'jobs_detail_full', (select count(*) from enger.jobs
                          where is_published and remote_type is not null
                            and (detail is not null or work_location is not null)),
    'cand_total',        (select count(*) from enger.candidates),
    'cand_proposable',   (select count(*) from enger.candidates where status = '提案可'),
    'cand_skills',       (select count(*) from enger.candidates where array_length(skills,1) is not null),
    'cand_profile_full', (select count(*) from enger.candidates
                           where array_length(skills,1) is not null
                             and (rate is not null or salary_min is not null)),
    'cand_stale',        (select count(*) from enger.candidates
                           where coalesce(imported_at, created_at) < now() - interval '30 days'),
    'cand_dupes',        (select count(*) from
                           (select 1 from enger.candidates
                             where name is not null and btrim(name) <> ''
                             group by lower(btrim(name)) having count(*) > 1) t)
  );
$$;
grant execute on function enger.matching_stats() to anon, authenticated, service_role;

-- ============================================================
-- companies-rpc.sql
-- ============================================================
create or replace function enger.company_overview()
returns json
language sql
stable
as $$
  select coalesce(json_agg(row_to_json(c) order by c.active_jobs desc, c.job_count desc), '[]'::json)
  from (
    select
      g.name, g.job_count, g.active_jobs, g.focus_jobs, g.last_job_at, g.avg_rate,
      case when g.job_count >= 10 then 'A' when g.job_count >= 3 then 'B' else 'C' end as tier,
      case
        when g.last_job_at < now() - interval '90 days' then '休眠'
        when g.job_count >= 10 then '主要'
        when g.job_count <= 2 then '新規'
        else '拡大中'
      end as status,
      coalesce(pr.proposals_total, 0) as proposals_total,
      coalesce(pr.won, 0) as won,
      coalesce(pr.lost, 0) as lost,
      lm.fb_sentiment    as last_sentiment,
      lm.relation_status as last_relation,
      lm.meeting_date    as last_meeting_at,
      coalesce(mc.meeting_count, 0) as meeting_count
    from (
      select
        j.client_name as name,
        count(*) as job_count,
        count(*) filter (where coalesce(j.status,'募集中') = '募集中') as active_jobs,
        count(*) filter (where j.is_focus) as focus_jobs,
        max(j.created_at) as last_job_at,
        round(avg(coalesce(j.salary_max, j.salary_min)))::int as avg_rate
      from enger.jobs j
      where j.is_published and j.client_name is not null and btrim(j.client_name) <> ''
      group by j.client_name
    ) g
    left join (
      select company,
        count(*) as proposals_total,
        count(*) filter (where stage = '稼働決定') as won,
        count(*) filter (where stage in ('見送り','失注')) as lost
      from enger.proposals where company is not null group by company
    ) pr on pr.company = g.name
    left join (
      select company_name, count(*) as meeting_count from enger.meetings group by company_name
    ) mc on mc.company_name = g.name
    left join lateral (
      select fb_sentiment, relation_status, meeting_date
      from enger.meetings m where m.company_name = g.name
      order by meeting_date desc nulls last, created_at desc
      limit 1
    ) lm on true
  ) c;
$$;
grant execute on function enger.company_overview() to anon, authenticated, service_role;
