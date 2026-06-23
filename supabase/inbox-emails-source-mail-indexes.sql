-- 「元メール」解決（attachLatestSourceMail）を高速化するためのインデックス。
--
-- 背景:
--   提案管理(/proposals)・人材/案件の詳細では、attachLatestSourceMail() が inbox_emails から
--   「同案件/同人材/同送信元」の直近メールを引き当てて source_mail_url を更新する。その絞り込みは
--     ・registered_job_no IN (...)
--     ・registered_candidate_no IN (...)
--     ・from_email IN (...)
--   を ORDER BY received_at DESC で行うが、これらの列にインデックスが無く、メール回収で
--   inbox_emails が大きくなると全表スキャンになって極端に遅くなる（ページが「読み込み中…」のまま
--   ハングする原因）。実際に絞り込みに使う列へインデックスを張って線形スキャンを避ける。
--
-- 適用: 中央 Supabase の SQL Editor でこのファイルを実行（再実行可・既存環境にも安全に追加できる）。

-- 同案件/同人材の直近メール引き当て用。NULL は対象外（登録済みのみ参照）なので部分インデックスにして軽量化。
create index if not exists inbox_emails_reg_job_idx
  on enger.inbox_emails (registered_job_no, received_at desc)
  where registered_job_no is not null;

create index if not exists inbox_emails_reg_cand_idx
  on enger.inbox_emails (registered_candidate_no, received_at desc)
  where registered_candidate_no is not null;

-- 送信元一致の引き当て用。attachLatestSourceMail は from_email を「原文のまま」.in() で照合する
-- （取込時に Gmail の from_email をそのまま両側へ設定するため大小も一致する）。よって素の列に張る。
create index if not exists inbox_emails_from_email_idx
  on enger.inbox_emails (from_email, received_at desc)
  where from_email is not null;

analyze enger.inbox_emails;
