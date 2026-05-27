-- ============================================================
-- 単価アップ履歴  enger.engagement_rate_changes  (冪等)
--   稼働契約の月額単価を「いつ・いくらから・いくらへ」上げた(変えた)かを記録。
--   現在の単価は engagements.monthly_rate（常に最新＝新単価）、本テーブルはその変更ログ。
-- ============================================================

create table if not exists enger.engagement_rate_changes (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references enger.engagements(id) on delete cascade,
  effective_date date not null,                 -- 適用日（この日から新単価）
  old_rate       numeric,                        -- 旧月額(万) 記録時点の monthly_rate
  new_rate       numeric not null,               -- 新月額(万)
  note           text,                           -- メモ（理由・経緯など）
  created_at     timestamptz not null default now()
);

create index if not exists engagement_rate_changes_eng_idx
  on enger.engagement_rate_changes (engagement_id, effective_date desc);

-- RLS: 公開読み取り（社内ツール前提）/ 書き込みは service_role のみ
alter table enger.engagement_rate_changes enable row level security;
drop policy if exists engagement_rate_changes_read on enger.engagement_rate_changes;
create policy engagement_rate_changes_read on enger.engagement_rate_changes for select using (true);
grant select on enger.engagement_rate_changes to anon, authenticated;
grant all    on enger.engagement_rate_changes to service_role;

-- 確認
-- select e.candidate_name, r.effective_date, r.old_rate, r.new_rate,
--        (r.new_rate - coalesce(r.old_rate,0)) as diff, r.note
--   from enger.engagement_rate_changes r
--   join enger.engagements e on e.id = r.engagement_id
--  order by r.effective_date desc;
