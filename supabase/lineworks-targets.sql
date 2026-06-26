-- ============================================================
-- LINE WORKS 送信先（ENGER → LINE 共有の宛先候補）テーブル（冪等）
--   Bot が参加するトークから webhook が届いた際に、その送信先(channelId / userId)を
--   記憶しておき、マッチング画面の「LINEに送る」で宛先として選べるようにする。
--   ※ 手で channelId を調べる必要をなくすための仕組み。
-- ============================================================
create table if not exists enger.lineworks_targets (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('channel', 'user')), -- channel=グループ / user=1:1
  target_id    text not null,                                     -- channelId または userId
  name         text,                                              -- 表示名（取得できれば）
  last_text    text,                                              -- 直近メッセージ（識別の手がかり）
  last_seen_at timestamptz not null default now(),
  unique (kind, target_id)
);

create index if not exists lineworks_targets_seen_idx
  on enger.lineworks_targets (last_seen_at desc);

-- 確認
-- select kind, target_id, last_text, last_seen_at from enger.lineworks_targets order by last_seen_at desc;
