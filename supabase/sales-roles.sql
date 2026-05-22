-- ============================================================
-- 営業の区分（インサイド/アウトサイド）と 案件のエンド担当 (冪等)
--   インサイド: マッチング→提案（提案者）
--   アウトサイド: エンド開拓・打合せ（案件のエンド担当）
--   提案した時点で 提案者(インサイド) と エンド担当(アウトサイド) がチームになる。
-- ============================================================

-- 担当者マスタに区分
alter table enger.staff add column if not exists position text;  -- 'inside' | 'outside' | null

-- 案件に エンド担当（アウトサイド）の名前
alter table enger.jobs  add column if not exists outside_owner text;
create index if not exists jobs_outside_owner_idx on enger.jobs (outside_owner);

-- 確認
-- select name, position, is_proposer, is_closer from enger.staff order by sort;
-- select job_no, title, client_name, outside_owner from enger.jobs where outside_owner is not null;
