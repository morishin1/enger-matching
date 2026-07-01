-- #263 ログイン停止・制限解除（ENGERフリーランス）
--   物理削除（退会処理）とは別に、データを残したまま一時的にログインを遮断（凍結）し、
--   いつでも元に戻せるフラグ。NULL=通常 / タイムスタンプあり=ログイン停止中。
--   実際のログイン遮断は Supabase Auth の ban（auth.users.banned_until）で行い、
--   この列は「誰がいつ停止されたか」の記録と一覧バッジ表示・LP側バリデーションに使う。
alter table public.profiles add column if not exists login_suspended_at timestamptz;

comment on column public.profiles.login_suspended_at is 'ログイン停止（凍結）日時。NULL=通常。管理画面(#263)から設定/解除。';
