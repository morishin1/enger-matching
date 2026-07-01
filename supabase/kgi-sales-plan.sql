-- KGIダッシュボード：月間売上目標（手動）と、そこから逆算したKPI割り振り（AI）を保存する。
--   ・sales_target_man：月間売上目標（万円・手動入力）。
--   ・plan：売上目標から逆算した月次KPI（稼働人数/面談/提案/打ち合わせ）＋前提（平均単価・転換率）。
--     形式: { avgDealMan, conv:{appointmentToProposal, proposalToMeeting, meetingToPlacement},
--             monthly:{placement, meeting, proposal, appointment}, rationale }
--   ・週次/日次は表示時に「当月の営業日数」で割って算出する（DBには持たない）。
create table if not exists enger.kgi_sales_plan (
  id               uuid primary key default gen_random_uuid(),
  month            date not null,           -- 月初（YYYY-MM-01）
  sales_target_man numeric,                 -- 月間売上目標（万円）
  inside_count     int,                     -- インサイド営業の人数（打ち合わせ容量の見積り用）
  outside_count    int,                     -- アウトサイド営業の人数（同上）
  plan             jsonb,                   -- AI逆算結果（上記＋headcount/feasible/advice）
  updated_by_email text,
  updated_by_name  text,
  updated_at       timestamptz default now(),
  unique (month)
);

-- 既存テーブルへの後追い（列が無い環境向け）。
alter table enger.kgi_sales_plan add column if not exists inside_count  int;
alter table enger.kgi_sales_plan add column if not exists outside_count int;
alter table enger.kgi_sales_plan add column if not exists avg_deal_man  numeric;  -- 平均単価（万円/名・月）＝手入力。逆算の分母。

alter table enger.kgi_sales_plan enable row level security;
grant select on enger.kgi_sales_plan to anon, authenticated;
grant all on enger.kgi_sales_plan to service_role;

comment on table enger.kgi_sales_plan is 'KGIダッシュボードの月間売上目標（手動）＋人員配分（inside/outside）とAI逆算KPI割り振り（月次）。';
