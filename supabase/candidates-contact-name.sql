-- candidates に「窓口担当者名（SES窓口・エージェント担当者）」を保存する列を追加。
--   jobs.contact_name と対称の設計。案件側に既にある「窓口担当者名」を人材側にも持たせ、
--   LINE/メール取込時の差出人や、提案メールの宛先・挨拶文（CandMailBodyCard の greeting）に
--   利用する。コード側は既に cand.contact_name を参照する箇所がある（DB列が無く undefined だった）。
--   未マイグレ環境でもアプリは動く（fail-soft: column or message に matched）。
alter table enger.candidates add column if not exists contact_name text;
comment on column enger.candidates.contact_name is '窓口担当者名（SES窓口・エージェントの担当者氏名）。jobs.contact_name と対称。提案メールの宛先表示・挨拶文に利用。';
