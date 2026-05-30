-- LP登録者(public.profiles)の連絡先列。LP 側で取得していれば dx の「LP登録」一覧に表示される。
-- 既に存在する場合は何もしない。LP のフォーム項目に合わせて列名を調整してください。
alter table public.profiles add column if not exists phone        text;  -- 電話番号
alter table public.profiles add column if not exists contact_line text;  -- LINE / メッセージID
-- 登録日時は既存の created_at を使用（追加不要）。
