-- ============================================================
-- アプリ設定  enger.app_settings  （key/value の JSON ストア）
--   現状の用途: 注力(お気に入り)定義  key='focus_criteria'
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

-- 既定の注力定義（空）を用意（任意）。管理者が「設定 → 注力の定義」で更新します。
insert into enger.app_settings (key, value)
values ('focus_criteria', '{"candidates":{"minRate":null,"skills":[],"keywords":[],"note":""},"jobs":{"minRate":null,"skills":[],"keywords":[],"note":""}}'::jsonb)
on conflict (key) do nothing;

-- 確認
-- select * from enger.app_settings;
