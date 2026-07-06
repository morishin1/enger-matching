-- ENGER business（enger-lp）向け公開API：会社情報の法人番号列。
--   PUT /api/public/company-profile が corporate_no を保存する（AI下書きの再実行や
--   企業の同定に使う）。未適用でも fail-soft（列を外して保存される）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。

alter table enger.company_profiles add column if not exists corporate_no text;

comment on column enger.company_profiles.corporate_no is '法人番号（13桁）。AI下書き（gBizINFO照会）と企業同定に使用';

-- 参考：法人番号→AI下書きを有効にするには、環境変数 GBIZINFO_TOKEN（gBizINFO APIトークン）を
--   Vercel に設定する（未設定でもホームページURLからのAI下書きは動作する）。
--   トークン申請: https://info.gbiz.go.jp/api/
