-- ============================================================
-- 企業からの人材リクエスト — enger.talent_interest
--   企業(client)が「おすすめ人材（匿名）」に対して「話を聞きたい」を押すと記録。
--   営業が確認して仲介する（個人情報は同意・営業経由でのみ開示）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.talent_interest (
  id           uuid primary key default gen_random_uuid(),
  company      text not null,                  -- 申込企業
  kind         text not null,                  -- 'candidate' | 'profile'
  candidate_id uuid,                            -- enger.candidates.id（kind=candidate）
  engineer_id  uuid,                            -- public.profiles.id（kind=profile）
  label        text,                            -- 表示用ラベル（イニシャル・職種など）
  note         text,
  status       text not null default 'new',     -- new / contacted / closed
  created_at   timestamptz not null default now()
);
create index if not exists talent_interest_company_idx on enger.talent_interest (company, created_at desc);
create unique index if not exists talent_interest_uniq on enger.talent_interest (company, kind, coalesce(candidate_id, engineer_id));

alter table enger.talent_interest enable row level security;
drop policy if exists talent_interest_read on enger.talent_interest;
create policy talent_interest_read on enger.talent_interest for select using (true);
grant select on enger.talent_interest to anon, authenticated;
grant all on enger.talent_interest to service_role;

-- 確認
-- select company, kind, label, status, created_at from enger.talent_interest order by created_at desc limit 20;
