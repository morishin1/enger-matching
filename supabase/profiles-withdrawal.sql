-- LP登録者(public.profiles)の「退会希望／退会処理」関連列。
--   フロー：本人が enger.jp 側で「退会する」を押す → withdrawal_requested_at が立つ
--          → dx（社内）が /engineers の人材詳細で確認し「退会処理する」を押す
--          → withdrawal_completed_at が立ち、以後は無効扱いで一覧から除外（or バッジ表示）
--   実削除はしない方針（LP側の auth.users と整合を取り、再ログインで生き返らない invalidation のみ）。
--
--   未マイグレ環境でもアプリは動くよう、コード側は列が無い場合のフォールバック select を持つ。

alter table public.profiles add column if not exists withdrawal_requested_at timestamptz;
alter table public.profiles add column if not exists withdrawal_reason       text;
alter table public.profiles add column if not exists withdrawal_completed_at timestamptz;

comment on column public.profiles.withdrawal_requested_at is '本人がLPで退会申請した日時（LP側で記録）。dx /engineers の「退会希望」バッジ／フィルタの判定に利用。';
comment on column public.profiles.withdrawal_reason       is '退会理由（本人入力）。dx の人材詳細で内容を確認する。';
comment on column public.profiles.withdrawal_completed_at is '社内で退会処理（無効化）を実施した日時。NULL でなければ無効扱い（一覧フィルタで除外可能）。';

create index if not exists profiles_withdrawal_requested_idx on public.profiles (withdrawal_requested_at) where withdrawal_requested_at is not null;
create index if not exists profiles_withdrawal_completed_idx on public.profiles (withdrawal_completed_at) where withdrawal_completed_at is not null;
