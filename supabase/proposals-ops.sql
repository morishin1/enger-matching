-- ============================================================
-- インサイド提案DB の運用に合わせて enger.proposals を拡張 (冪等)
--   架電進捗 / 提案者 / クロージング担当 / 企業担当者 / 失注理由・フェーズ
--   ステージ名は: 未対応 / 提案中 / 面談調整 / クロージング中 / 稼働決定 / 見送り / 要確認
-- ============================================================

alter table enger.proposals add column if not exists caller_status   text;     -- 架電進捗
alter table enger.proposals add column if not exists proposer        text;     -- 提案者
alter table enger.proposals add column if not exists closer          text;     -- クロージング担当
alter table enger.proposals add column if not exists client_contact  text;     -- 企業担当者
alter table enger.proposals add column if not exists lost_reason     text;     -- 失注理由(主要因)
alter table enger.proposals add column if not exists lost_phase      text;     -- 失注フェーズ
alter table enger.proposals add column if not exists ai_match        numeric;  -- AIのマッチ率
alter table enger.proposals add column if not exists called_at       date;     -- 架電日
alter table enger.proposals add column if not exists proposed_at     date;     -- 提案日

create index if not exists proposals_caller_idx on enger.proposals (caller_status);

-- 確認
-- select stage, count(*) from enger.proposals group by stage;
