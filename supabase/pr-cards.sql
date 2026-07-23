-- ============================================================
-- X集客カード  enger.pr_cards
--   /pr の「カードで投稿」機能。担当者が Canva 等で作ったカード画像を
--   アップロードし、公開ページ dx.enger.jp/x/<token> の OGP 画像として配信する。
--   Xにその共有URLを投稿すると、カードが大きなリンクカードとして表示され、
--   タップで登録/案件ページ（UTM付き）へ遷移する。
--
--   ・画像は Supabase Storage の【公開バケット "pr-cards"】に保存する。
--     ※ バケットはSQLでは作れないため、Supabaseダッシュボードの
--       Storage → New bucket → 名前 "pr-cards"・Public にチェック で手動作成する
--       （既存の "billing" バケットと同じ運用）。
--   ・行の読み取りは /x ページのサーバー側（service_role）でのみ行うため、
--     anon/authenticated への公開ポリシーは付けない（share_links と同方針）。
-- ============================================================

create table if not exists enger.pr_cards (
  id               uuid primary key default gen_random_uuid(),
  token            text not null unique,          -- /x/<token> のURLキー
  image_url        text not null,                 -- 公開バケットの画像URL（OGP画像）
  image_path       text,                          -- ストレージ内パス（削除用）
  title            text,                          -- og:title（未指定なら既定文言）
  description      text,                          -- og:description
  redirect_url     text not null,                 -- 遷移先（UTM付き）
  operator         text,                          -- 作成した担当者名
  created_by_email text,
  view_count       int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists pr_cards_created_idx on enger.pr_cards (created_at desc);
create index if not exists pr_cards_token_idx   on enger.pr_cards (token);

alter table enger.pr_cards enable row level security;
grant all on enger.pr_cards to service_role;
-- anon/authenticated には公開しない（/x はサーバー側 service_role で読む）。

-- 確認:
-- select token, redirect_url, operator, created_at from enger.pr_cards order by created_at desc limit 20;
