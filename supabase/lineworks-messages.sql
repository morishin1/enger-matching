-- ============================================================
-- LINE WORKS メッセージ履歴（ENGER内で「LINEのやりとり」を表示するため）（冪等）
--   ・inbound : トークに届いた相手の投稿（webhook受信）
--   ・outbound: Bot/ENGER からの返信（自動マッチ返信・手動返信・「LINEに送る」）
--   ※ Bot API は過去履歴を取得できないため、保存はデプロイ以降のメッセージのみ。
-- ============================================================
create table if not exists enger.lineworks_messages (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('channel', 'user')), -- channel=グループ / user=1:1
  target_id  text not null,                                     -- channelId または userId
  direction  text not null check (direction in ('inbound', 'outbound')),
  msg_type   text not null default 'text' check (msg_type in ('text', 'cards')),
  body       text,                                              -- テキスト本文（msg_type='text'）
  cards      jsonb,                                             -- マッチ結果カード配列（msg_type='cards'）
  sender_name text,                                             -- 表示名（Bot名 / 操作者名 / 相手名）
  created_at timestamptz not null default now()
);

create index if not exists lineworks_messages_target_idx
  on enger.lineworks_messages (kind, target_id, created_at);

-- 確認
-- select direction, msg_type, body, created_at from enger.lineworks_messages
--   where kind = 'channel' and target_id = '...' order by created_at;
