-- スキルシート（職務経歴書）のAI解析結果をキャッシュする列。
--   GAS取込・LP登録時にGoogle Driveからファイルを取得し、
--   AIで「要約 + 追加スキル抽出」をして保存。マッチング時は再フェッチ不要で高速参照。

alter table enger.candidates add column if not exists skill_sheet_summary text;
alter table enger.candidates add column if not exists skill_sheet_skills text[];
alter table enger.candidates add column if not exists skill_sheet_extracted_at timestamptz;
alter table enger.candidates add column if not exists skill_sheet_error text;

comment on column enger.candidates.skill_sheet_summary is 'スキルシートのAI要約（300字程度・強み/職務範囲/技術領域）';
comment on column enger.candidates.skill_sheet_skills  is 'スキルシートから抽出した追加スキル（手入力 skills と和集合してマッチング採点に使用）';
comment on column enger.candidates.skill_sheet_extracted_at is 'スキルシートを最後にAI解析した日時';
comment on column enger.candidates.skill_sheet_error   is '解析失敗時のエラーメッセージ（権限不足/未対応形式 等のデバッグ用）';
