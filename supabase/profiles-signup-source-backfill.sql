-- ============================================================
-- 既存の public.profiles を、ヒューリスティックで signup_source/signup_method に
-- 埋め戻す（バックフィル）。LP側が今後 INSERT 時に明示保存するまでのつなぎ。
--
-- 実行前に supabase/profiles-signup-source.sql で列を追加しておくこと。
-- 何度実行しても同じ結果になる（COALESCE で既存値を上書きしない）。
-- ============================================================

-- 1) 無限道場 (role='student')
update public.profiles
   set signup_source = coalesce(signup_source, 'dojo'),
       signup_method = coalesce(signup_method,
         case when github_login is not null or github_id is not null then 'github'
              when email is not null then 'email'
              else null end)
 where role = 'student';

-- 2) エンジャー: GitHub 連携
update public.profiles
   set signup_source = coalesce(signup_source, 'enger'),
       signup_method = coalesce(signup_method, 'github')
 where (github_login is not null or github_id is not null)
   and (role is null or role <> 'student');

-- 3) エンジャー: メール / フォーム登録（display_name か email があり GitHub 系が無い）
update public.profiles
   set signup_source = coalesce(signup_source, 'enger'),
       signup_method = coalesce(signup_method, 'email')
 where (display_name is not null or email is not null)
   and github_login is null and github_id is null
   and (role is null or role <> 'student');

-- 確認
-- select signup_source, signup_method, count(*)
--   from public.profiles
--   group by 1, 2 order by 1, 2;
