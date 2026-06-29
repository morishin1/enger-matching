-- ============================================================
-- enger.jp ↔ dx.enger.jp 連携用：共有スキーマ public.profiles の列定義
--   enger.jp（会員サイト/LP）と dx.enger.jp は同じ Supabase プロジェクトを共有し、
--   会員・人材は public.profiles に保存する。dx はこの列を読み取って「LP登録」に表示する。
--   ※ enger.jp 側の登録フォームが、これらの列に値を入れて保存することが前提。
-- ============================================================

-- 流入元/登録方式（どのLP・どの方法で登録したか）
alter table public.profiles add column if not exists signup_source text;   -- 'enger_lp' | 'mugen_dojo' | 任意のLPキー
alter table public.profiles add column if not exists signup_method text;   -- 'github' | 'google' | 'form' | 'email'

-- 連絡先
alter table public.profiles add column if not exists phone        text;    -- 電話番号
alter table public.profiles add column if not exists contact_line text;    -- LINE / メッセージID

-- 既存で利用している主な列（参考・dxが読むもの）:
--   id, display_name, github_login, github_id, avatar_url, email, role,
--   skills(jsonb/text[]), primary_language, total_stars, total_repos,
--   estimated_pay_low/mid/high, portfolio_url, skill_sheet_url, skill_sheet_name,
--   headline, bio, qiita_id, last_login_at, created_at(登録日時)
--
-- 氏名表示（dx のチャット候補一覧・登録者一覧で読む列。enger.jp の登録フォームが保存する想定）:
--   last_name_kanji, first_name_kanji   … 姓・名（漢字）。両方あれば「姓 名（姓）（イニシャル）」表示。
--   last_name_kana,  first_name_kana    … 姓・名（フリガナ）。イニシャル自動生成にも利用。
--   initial_auto                        … 自動生成イニシャル（例 "FT"）。
--   ※ これらが未登録（漢字氏名が無い）の人材は、dx 側で「人材ID（E-XXXXX）」を表示名に使う。
--     dx は列名差異を吸収して読むが（lib/chat.ts の候補キー）、上記の正規列名で保存されるのが望ましい。

create index if not exists profiles_signup_source_idx on public.profiles (signup_source);
create index if not exists profiles_created_at_idx     on public.profiles (created_at);

-- 確認
-- select id, display_name, email, signup_source, signup_method, phone, contact_line, created_at
--   from public.profiles order by created_at desc limit 20;
