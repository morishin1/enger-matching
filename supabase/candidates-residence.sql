-- #330④：人材に「居住地」列を追加する。
--   最寄駅（candidates.location）とは別の項目。LINE登録・ENGERフリーランス・その他すべての
--   登録経路の人材に対して入力できる。
--   冪等（何度実行しても安全）。Supabase の SQL Editor で実行してください。
alter table enger.candidates add column if not exists residence text;
comment on column enger.candidates.residence is '居住地（最寄駅=location とは別）。#330';
