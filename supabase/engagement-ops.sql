-- ============================================================
-- 稼働管理の拡張：利益・精算・法務・契約更新 (冪等)
--   原価/粗利の表示は「権限 × 所属区分」でサーバ側マスク（プロパー給与の漏洩防止）。
-- ============================================================

-- 利益管理
alter table enger.engagements add column if not exists cost          numeric;  -- 原価/支払額(BP・フリーへの支払 / プロパーは給与相当)
-- 所属区分（マスク判定キー。稼働化時に人材から引き継ぎ、管理者が編集可）
alter table enger.engagements add column if not exists affiliation   text;     -- 'プロパー' | 'BP' | 'フリーランス'

-- 精算実務
alter table enger.engagements add column if not exists settle_min    numeric;  -- 清算下限(時間/月)
alter table enger.engagements add column if not exists settle_max    numeric;  -- 清算上限(時間/月)
alter table enger.engagements add column if not exists work_hours    numeric;  -- 当月稼働時間

-- 法務リスク管理（回収ステータス）
alter table enger.engagements add column if not exists contract_status text;   -- 契約書: 未 / 送付済 / 回収済
alter table enger.engagements add column if not exists po_status       text;   -- 注文書: 未 / 送付済 / 回収済

-- 契約更新（既追加分・再掲）
alter table enger.engagements add column if not exists renewal_due    date;
alter table enger.engagements add column if not exists renewal_status text;     -- 未着手/打診中/更新合意/更新済/終了予定

create index if not exists engagements_renewal_idx on enger.engagements (renewal_due);

-- 既存データの所属区分を人材マスタから補完（名前一致のもの）
update enger.engagements e
   set affiliation = c.affiliation
  from enger.candidates c
 where e.affiliation is null
   and e.candidate_name is not null
   and c.name = e.candidate_name
   and c.affiliation is not null;

-- 確認
-- select candidate_name, affiliation, monthly_rate, cost, contract_status, renewal_status from enger.engagements;
