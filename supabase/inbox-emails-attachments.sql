-- 受信メールの添付（スキルシート等）を公開URLとして保存する列（管理NO: メール添付スキルシート対応）。
--   ・Gmail 同期時に、スキルシートらしい添付（PDF/Excel/Word/圧縮 等）を Storage バケット
--     "skillsheets" の inbox/<gmail_message_id>/ 配下へ保存し、その公開URLをここに記録する。
--   ・形式: jsonb 配列 [{ name, url, path, size, mime }]
--   ・人材として登録する際、本文にスキルシートのリンクが無ければ、この添付URLを
--     candidates.skill_sheet_url に採用する（リンク送付／添付送付の両対応）。
--
-- 前提: Storage に公開バケット "skillsheets" が存在すること（フリーランスのスキルシートと共用）。
--   無い場合は Supabase Storage で public バケット "skillsheets" を作成してください。

alter table enger.inbox_emails
  add column if not exists attachments jsonb;

comment on column enger.inbox_emails.attachments is
  '保存済み添付（スキルシート等）の配列 [{name,url,path,size,mime}]。Storage:skillsheets/inbox/<msgid>/ の公開URL。';
