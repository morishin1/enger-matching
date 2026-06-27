-- ============================================================
-- チャット：担当者の社内メモを「スタッフ専用（service role のみ）」に隔離する。
--   背景：従来 memo は enger.chat_threads 上にあり、chat_threads は anon/authenticated に
--         select を許可（policy: using(true)）しているため、人材(フリーランス, enger.jp)が
--         自分のスレッドを読むと memo まで取得できてしまう状態だった。
--   対策：memo を別テーブル enger.chat_thread_memos に隔離。anon/authenticated には一切
--         grant せず RLS で遮断（service role だけが読み書き）。既存 memo は移行し、
--         漏洩源の chat_threads.memo は空にする（列自体は後方互換で残置）。
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.chat_thread_memos (
  thread_id  uuid primary key references enger.chat_threads (id) on delete cascade,
  memo       text,
  updated_at timestamptz not null default now()
);

-- RLS 有効化＋ポリシー無し＝anon/authenticated は（grant も無いので）一切アクセス不可。
alter table enger.chat_thread_memos enable row level security;
revoke all on enger.chat_thread_memos from anon, authenticated;
grant all on enger.chat_thread_memos to service_role;

-- 既存メモを移行（chat_threads.memo 列が存在する環境のみ）。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'enger' and table_name = 'chat_threads' and column_name = 'memo'
  ) then
    insert into enger.chat_thread_memos (thread_id, memo)
      select id, memo from enger.chat_threads where memo is not null and btrim(memo) <> ''
      on conflict (thread_id) do update set memo = excluded.memo, updated_at = now();
    -- 漏洩源を空にする（列は後方互換で残す）。
    update enger.chat_threads set memo = null where memo is not null;
  end if;
end $$;

-- 確認用：
-- select thread_id, left(memo, 40) from enger.chat_thread_memos limit 20;
