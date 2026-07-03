-- kgi-week-overrides.sql
-- 週次カレンダーの「目標数値」を手動で変動できるようにするための上書き値を保存する列。
--   ・既定は月次目標を営業日×旬ウェイトで自動配分（distributeMonthlyToWeeks）。
--   ・ここに保存があれば、その週×KPIの目標を上書きして表示・判定に使う（未保存の週は自動配分のまま）。
--   ・形： { "proposal":[w1,w2,...], "meeting":[...], "placement":[...], "appointment":[...] }
--         各配列は週インデックス順。null/欠落は自動配分にフォールバック。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。

alter table enger.kgi_sales_plan add column if not exists week_overrides jsonb;

comment on column enger.kgi_sales_plan.week_overrides is
  '週次カレンダーの目標上書き（KPIキー→週配列）。未保存の週は月次目標の自動配分にフォールバック。';
