-- ============================================================
-- 打ち合わせ記録DB (アウトサイドチーム) — enger.meetings
--   企業ごとの温度感・反応傾向を蓄積し、今後の対応に反映する。
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

create table if not exists enger.meetings (
  id              uuid primary key default gen_random_uuid(),
  title           text,
  company_name    text,                 -- 相手企業（jobs.client_name と名寄せ）
  meeting_date    date,
  their_contact   text,                 -- 相手側担当者
  our_owner       text,                 -- 自社担当者
  new_or_existing text,                 -- 新規 / 既存
  relation_status text,                 -- 🆕新規 / 🔄再構築 / ♻️継続 / 📌休眠
  fb_sentiment    text,                 -- 👍ポジティブ / 😐中立 / 👎ネガティブ / ⚠️競合比較
  ai_summary      text,                 -- AI要約
  enger_fb        text,                 -- エンジャーへのFB
  hit_points      text,                 -- 刺さった訴求点
  miss_points     text,                 -- 響かなかった点
  needs           text,                 -- 顧客の課題・ニーズ
  strategy        text,                 -- 戦略的示唆
  next_action_us   text,                -- 次回アクション(自社)
  next_action_them text,                -- 次回アクション(相手)
  competitors     text[] default '{}',  -- 競合・他社言及
  competitor_detail text,
  tags            text[] default '{}',  -- 横串タグ
  transcript_url  text,                 -- 元文字起こしリンク(Drive)
  publishable     text,                 -- 配信可能 / 配信不可
  created_at      timestamptz not null default now()
);
create index if not exists meetings_company_idx on enger.meetings (company_name);
create index if not exists meetings_date_idx on enger.meetings (meeting_date);

alter table enger.meetings enable row level security;
drop policy if exists meetings_read on enger.meetings;
create policy meetings_read on enger.meetings for select using (true);
grant select on enger.meetings to anon, authenticated;
grant all on enger.meetings to service_role;

-- 確認
-- select count(*) from enger.meetings;
