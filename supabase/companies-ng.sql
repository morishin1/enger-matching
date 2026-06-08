-- 取引NG（取引停止）フラグ。
--   撤退検討アラートが出ている企業を、根拠つきで「NG（取引しない）」に指定するための列。
--   ・is_ng       : true=取引NG（マッチング/提案で警告・対象外候補に）
--   ・ng_reason   : NGの理由（撤退検討の根拠：失注多数 / 単価合わない 等）
--   ・ng_at       : 設定日時
--   ・ng_by       : 設定者（氏名）

alter table enger.companies
  add column if not exists is_ng     boolean not null default false,
  add column if not exists ng_reason text,
  add column if not exists ng_at     timestamptz,
  add column if not exists ng_by     text;

create index if not exists companies_ng_idx on enger.companies (is_ng) where is_ng = true;
