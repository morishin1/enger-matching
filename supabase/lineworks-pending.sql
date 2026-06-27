-- ============================================================
-- LINE WORKS 取込の「スキル待ち」保留ドラフト
--   #案件/#人材 で送られたがスキルが無い投稿を、その場で破棄せず一時保存する。
--   Bot が「スキルだけ返信してください」と聞き返し、送信者が次に送ったスキルで
--   登録を完了させる（対話による補完）。1時間で失効（古い保留は無効）。
--   sender_key は投稿者(userId・無ければchannelId)。1会話=1保留（最新で上書き）。
--   service_role のみアクセス（人材/anon には公開しない）。
-- ============================================================
create table if not exists enger.lineworks_pending (
  sender_key text primary key,
  kind       text not null,                 -- 'candidates' | 'jobs'
  fields     jsonb not null default '{}'::jsonb,  -- 抽出済みフィールド（skills 以外も保持）
  reply_target jsonb,                        -- 返信先（channelId/userId）
  created_at timestamptz not null default now()
);

alter table enger.lineworks_pending enable row level security;
grant all on enger.lineworks_pending to service_role;

comment on table enger.lineworks_pending is 'LINE WORKS 取込のスキル待ち保留ドラフト（Botが対話でスキルを聞き返すための一時保存）';
