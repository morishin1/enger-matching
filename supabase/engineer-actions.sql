-- ============================================================
-- エンジャー登録エンジニアへの対応履歴 — enger.engineer_actions
--   enger.jp(public.profiles) で登録したエンジニアに対して、
--   いつ・誰が・どんな対応(スカウト/メール/返信/面談/見送り 等)をしたかを蓄積する。
--   重複アプローチ防止・KPI・引き継ぎに利用。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.engineer_actions (
  id            uuid primary key default gen_random_uuid(),
  engineer_id   uuid not null,            -- public.profiles.id（連携エンジニア）
  engineer_name text,                     -- 表示名スナップショット（一覧用）
  action        text not null,            -- スカウト送信/メール送信/返信あり/面談設定/見送り/メモ 等
  note          text,                     -- 自由記述（任意）
  operator      text,                     -- 対応した担当者（氏名 or メール）
  created_at    timestamptz not null default now()
);
create index if not exists engineer_actions_eng_idx
  on enger.engineer_actions (engineer_id, created_at desc);

alter table enger.engineer_actions enable row level security;
drop policy if exists engineer_actions_read on enger.engineer_actions;
create policy engineer_actions_read on enger.engineer_actions for select using (true);
grant select on enger.engineer_actions to anon, authenticated;
grant all on enger.engineer_actions to service_role;

-- 確認
-- select engineer_name, action, operator, created_at
-- from enger.engineer_actions order by created_at desc limit 20;
