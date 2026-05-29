-- ============================================================
-- public.profiles に「LP登録の識別列」を追加
--   - signup_source : どのLPから登録されたか (例: 'enger' / 'dojo')
--   - signup_method : 登録方式 (例: 'github' / 'google' / 'form' / 'email')
--   - エンジャーLP / 無限道場LP どちらも GitHub / Google / フォーム登録に対応する想定
--   - 新しいLP（例: lpX）を追加する場合は signup_source に新しい値を入れるだけ
--   - 列が NULL の既存データは、enger 側のヒューリスティックでフォールバック判定
-- ============================================================

alter table public.profiles
  add column if not exists signup_source text,   -- 'enger' | 'dojo' | 将来の値
  add column if not exists signup_method text;   -- 'github' | 'google' | 'form' | 'email'

create index if not exists profiles_signup_source_idx on public.profiles (signup_source);

-- LP 側の保存例（INSERT 時に値を入れる）
--   insert into public.profiles (..., signup_source, signup_method)
--   values (..., 'enger', 'github');
--   insert into public.profiles (..., signup_source, signup_method)
--   values (..., 'dojo',  'google');
