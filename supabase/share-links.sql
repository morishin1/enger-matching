-- share-links.sql
-- 外部共有リンク：ENGER にログインしていない相手へ、案件/人材の「匿名サマリ」を
-- 公開ページ(/share/<token>)で見せるための台帳。
--   ・token は推測不可のランダム値（URL に載せる・unique）
--   ・passcode は 6桁の簡易パスコード（null なら URL を知っていれば誰でも閲覧可）
--   ・expires_at を過ぎたリンクは無効（発行時の既定は30日）
--   ・response は閲覧者の回答（興味あり / 見送り）。メール版「話を進める/見送り」のWEB版。
--   ・表示内容はアプリ側で匿名化（人材＝イニシャル＋スキル＋単価。氏名/連絡先/所属は出さない）

create table if not exists enger.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null check (kind in ('job','candidate')),
  job_no int,
  candidate_no int,
  passcode text,
  created_by_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count int not null default 0,
  last_viewed_at timestamptz,
  passcode_attempts int not null default 0,
  response text,
  responded_at timestamptz
);

-- 既存環境向け（過去版の share-links.sql を実行済みの場合の追カラム）。
alter table enger.share_links add column if not exists passcode_attempts int not null default 0;
alter table enger.share_links add column if not exists response text;
alter table enger.share_links add column if not exists responded_at timestamptz;

create index if not exists share_links_kind_no_idx on enger.share_links (kind, job_no, candidate_no);

-- サービスロール（サーバ側）からのみ読み書きする。anon/認証ユーザーの直接アクセスは不可。
alter table enger.share_links enable row level security;

-- パスコード失敗回数のアトミック加算（同時リクエストでカウントが飛ぶ lost update を防ぐ）。
create or replace function enger.share_passcode_fail(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update enger.share_links
     set passcode_attempts = passcode_attempts + 1
   where token = p_token;
$$;

comment on table enger.share_links is '外部共有リンク（未ログイン閲覧用の匿名サマリページ /share/<token> の台帳）';
comment on column enger.share_links.passcode is '6桁の簡易パスコード（null=パスコードなしで閲覧可）';
comment on column enger.share_links.expires_at is '有効期限（過ぎたリンクは無効。発行時の既定は30日）';
comment on column enger.share_links.passcode_attempts is 'パスコード連続失敗回数（総当たり対策。上限超過でリンク無効・再発行が必要）';
comment on column enger.share_links.response is '閲覧者の回答（興味あり / 見送り）。回答すると発行者へ通知される';
