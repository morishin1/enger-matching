-- #334①：マッチングレコード（proposals）に「進捗状況」列を追加する。
--   進捗状況：未処理 / 案件側から返事待ち / 人材側から返事待ち / 両方から返事待ち。
--   progress_updated_at＝「編集を保存」で進捗を更新した最新日（一覧のカッコ内に表示）。
--   冪等（何度実行しても安全）。Supabase の SQL Editor で実行してください。
alter table enger.proposals add column if not exists progress_status text;
alter table enger.proposals add column if not exists progress_updated_at timestamptz;
comment on column enger.proposals.progress_status is '進捗状況（未処理/案件側から返事待ち/人材側から返事待ち/両方から返事待ち）。#334';
comment on column enger.proposals.progress_updated_at is '進捗状況を保存した最新日時。#334';
