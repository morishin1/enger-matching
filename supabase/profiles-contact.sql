-- LP登録者(public.profiles)の連絡先列。
-- LP のフォーム項目に合わせて、いずれか1つの列名で持っていれば dx で自動表示されます。
--   電話    : phone / phone_number / tel / mobile
--   メッセージ: contact_line / line_id / line / messenger / message_app
-- 例（推奨：phone / contact_line）。既に別名で存在するなら追加不要。

alter table public.profiles add column if not exists phone        text;  -- 電話番号
alter table public.profiles add column if not exists contact_line text;  -- LINE / メッセージID

-- 登録日時は既存の created_at をそのまま使用（追加不要）。
