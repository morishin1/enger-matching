-- kgi-week-actual-overrides.sql
-- #308：週次カレンダーの「実績」を手動で補正できるようにするための上書き値を保存する列。
--   ・既定は提案管理(proposals)・打ち合わせ(meetings)からの自動集計。
--   ・ここに保存があれば、その週×KPIの実績を上書きして表示・達成率に使う（未保存の週は自動集計のまま）。
--   ・形： { "proposal":[w1,w2,...], "meeting":[...], "placement":[...], "appointment":[...] }
--         各配列は週インデックス順。null/欠落は自動集計にフォールバック。
--   ・week_overrides（目標の上書き列）と対になる列。同じ kgi_sales_plan（月1行）に持つ。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。

alter table enger.kgi_sales_plan add column if not exists week_actual_overrides jsonb;

comment on column enger.kgi_sales_plan.week_actual_overrides is
  '週次カレンダーの実績上書き（KPIキー→週配列）。未保存の週は提案管理/打ち合わせの自動集計にフォールバック。';
