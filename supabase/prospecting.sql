-- ============================================================
-- エンド開拓（Prospecting）DB — enger.prospects / prospect_activities
--   売上逆算の入口：リスト投入 → 接触 → アポ → 企業管理へ昇格。
--   Supabase SQL Editor で何度実行しても安全な冪等SQL。
-- ============================================================

create table if not exists enger.prospects (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  normalized_name text generated always as (lower(regexp_replace(btrim(company_name), '[[:space:]　]+', '', 'g'))) stored,
  industry text,
  website text,
  normalized_url text generated always as (lower(regexp_replace(coalesce(website, ''), '^https?://(www\.)?|/$', '', 'g'))) stored,
  contact_form_url text,
  phone text,
  contact_name text,
  status text not null default '未接触' check (status in ('未接触','フォーム送信済','架電済','反応あり','アポ獲得','商談','ENGER登録','見送り・NG')),
  priority integer not null default 50 check (priority between 0 and 100),
  owner_staff text,
  ng_reason text,
  note text,
  source_list text,
  last_activity_at timestamptz,
  next_action_at timestamptz,
  promoted_company_name text,
  promoted_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists enger.prospect_activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references enger.prospects(id) on delete cascade,
  activity_type text not null check (activity_type in ('フォーム送信','架電','メール','反応','メモ','昇格')),
  result text check (result is null or result in ('不通','受付止まり','担当接続','アポ','送信済','返信あり','NG','その他')),
  note text,
  activity_at timestamptz not null default now(),
  actor text,
  created_at timestamptz not null default now()
);

create unique index if not exists prospects_normalized_name_uniq on enger.prospects (normalized_name);
create index if not exists prospects_status_idx on enger.prospects (status);
create index if not exists prospects_owner_idx on enger.prospects (owner_staff);
create index if not exists prospects_source_idx on enger.prospects (source_list);
create index if not exists prospects_next_action_idx on enger.prospects (next_action_at nulls first, priority desc);
create index if not exists prospect_activities_prospect_at_idx on enger.prospect_activities (prospect_id, activity_at desc);

create or replace function enger.set_prospects_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_prospects_updated_at on enger.prospects;
create trigger trg_prospects_updated_at
before update on enger.prospects
for each row execute function enger.set_prospects_updated_at();

alter table enger.prospects enable row level security;
alter table enger.prospect_activities enable row level security;

drop policy if exists prospects_read on enger.prospects;
create policy prospects_read on enger.prospects for select using (true);
drop policy if exists prospect_activities_read on enger.prospect_activities;
create policy prospect_activities_read on enger.prospect_activities for select using (true);

grant select on enger.prospects to anon, authenticated;
grant select on enger.prospect_activities to anon, authenticated;
grant all on enger.prospects to service_role;
grant all on enger.prospect_activities to service_role;

-- 確認
-- select status, count(*) from enger.prospects group by status order by status;
