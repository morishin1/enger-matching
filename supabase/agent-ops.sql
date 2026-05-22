-- ============================================================
-- エージェント・ダッシュボード強化用カラム (冪等)
--   3軸ダッシュボードの「面談調整」「契約更新」「粗利」「連絡途絶」を有効化する。
--   実行後、ダッシュボードが自動でこれらの値を使い始めます（未実行でも他は動作）。
-- ============================================================

-- 面談（これから捌く予定）: 提案に面談日程・面談ステータスを持たせる
alter table enger.proposals  add column if not exists meeting_date   date;   -- 面談/商談 予定日
alter table enger.proposals  add column if not exists meeting_status text;   -- 調整中/確定/実施済/見送り

-- 候補者: 最終接触日（連絡途絶の検知に使用）
alter table enger.candidates add column if not exists last_contact_at date;

-- 稼働(契約): 原価(粗利計算) と 更新回答期限(更新アラート)
alter table enger.engagements add column if not exists cost          numeric;  -- 月額原価(BPへの支払等)
alter table enger.engagements add column if not exists renewal_due   date;     -- 更新回答の期限
alter table enger.engagements add column if not exists renewal_status text;    -- 更新意向: 継続/未確認/終了予定

create index if not exists proposals_meeting_idx  on enger.proposals (meeting_date);
create index if not exists engagements_end_idx    on enger.engagements (end_date);

-- 確認
-- select id, job_title, end_date, monthly_rate, cost, renewal_due from enger.engagements order by end_date;
