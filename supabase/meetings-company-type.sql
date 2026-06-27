-- 打ち合わせ記録に「企業タイプ」列を追加。
--   SES（案件紹介のみ）/ SES（人材紹介のみ）/ SES（両方）/ エンド / 受託会社 / その他（自由入力）
--   フォームの「刺さった点」を「企業タイプ」に置き換えたことに伴う列。
alter table enger.meetings add column if not exists company_type text;

comment on column enger.meetings.company_type is '企業タイプ（SES案件のみ/人材のみ/両方・エンド・受託・その他）';
