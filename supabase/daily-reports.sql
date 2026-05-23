-- ============================================================
-- 日報  enger.daily_reports
--   数値はシステムが自動集計し、本人は「気づき」と「次の一手」を書く設計。
--   自己認識を促し、後から振り返れるよう蓄積する。
-- ============================================================

create table if not exists enger.daily_reports (
  id          uuid primary key default gen_random_uuid(),
  author      text not null,
  team        text,                            -- 営業/バックオフィス/開発/EC/サポート/その他
  report_date date not null default current_date,
  did         text[] not null default '{}',   -- やったこと（タップ選択）
  did_note    text,                            -- やったこと 自由記入
  learned     text,                            -- 気づき（うまくいった/詰まった/なぜ）
  next_action text,                            -- 明日の一手
  mood        text,                            -- 手応え（😀/😐/😟）
  metrics     jsonb,                           -- 当日の自動実績スナップショット
  ai_comment  text,                            -- AIコーチング（任意・1日1回）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 再実行用
alter table enger.daily_reports add column if not exists team text;
-- 共通フレーム（自問自答）の追加項目
alter table enger.daily_reports add column if not exists self_check jsonb;   -- 自己チェック(○△×)
alter table enger.daily_reports add column if not exists good       text;    -- うまくいったこと(Keep)
alter table enger.daily_reports add column if not exists problem    text;    -- 詰まった/課題(Problem)
alter table enger.daily_reports add column if not exists cause      text;    -- なぜ？(深掘り)
alter table enger.daily_reports add column if not exists outputs    numeric; -- 主要アウトプット数
alter table enger.daily_reports add column if not exists contacts   numeric; -- 顧客・関係者との接点数

create unique index if not exists daily_reports_uniq on enger.daily_reports (author, report_date);
create index if not exists daily_reports_date_idx on enger.daily_reports (report_date desc);

alter table enger.daily_reports enable row level security;
grant all on enger.daily_reports to service_role;
grant select on enger.daily_reports to anon, authenticated;
drop policy if exists daily_reports_read on enger.daily_reports;
create policy daily_reports_read on enger.daily_reports for select using (true);

-- 確認
-- select author, report_date, learned, next_action from enger.daily_reports order by report_date desc;
