-- ④ 人材のスキルシート（職務経歴書）URL を保持する列。
--   GAS が取り込んだ添付ファイルを Drive に保存し、その URL（または fileId）を
--   人材CSVの「スキルシートURL」列に入れて取り込む。クライアント向け提案メールに添付される。
alter table enger.candidates add column if not exists skill_sheet_url text;

comment on column enger.candidates.skill_sheet_url is 'スキルシート(職務経歴書)のURL。GASが取り込んだ添付ファイルのDriveリンク等。';
