-- ============================================================
-- AI応答の共有キャッシュ enger.ai_cache
--   目的: AI再ランキング / 今日のブリーフィング / メール抽出など、入力が同じなら
--         結果も同じ呼び出しを「インスタンスを跨いで」キャッシュし、再課金を防ぐ。
--   従来は各 API route の in-memory Map（プロセス再起動で消失・複数インスタンス間で非共有）
--   だったため、同じ入力でも別インスタンス/再起動後に再び LLM を呼んで二重課金していた。
--
--   key       : sha256(feature|raw) の16進。アプリ側で計算（長い入力でも固定長）。
--   value     : 応答（配列・文字列・オブジェクト）をそのまま JSON で保持。
--   created_at : TTL 判定に使用（読み出し側が created_at >= now()-maxAge で絞る）。
--
--   サーバー専用（service role のみ）。anon/authenticated には公開しない。
-- ============================================================

create table if not exists enger.ai_cache (
  key        text primary key,        -- sha256(feature|raw) hex
  feature    text not null,           -- rerank / brief / extract-proposal / extract-bulk ...
  value      jsonb not null,
  created_at timestamptz not null default now()
);

-- 機能別の古い行を掃除する運用クエリ用（任意）。読み出しは key 主キーで引くため必須ではない。
create index if not exists ai_cache_feature_created_idx on enger.ai_cache (feature, created_at);

alter table enger.ai_cache enable row level security;
grant all on enger.ai_cache to service_role;

-- 任意: TTL を超えた行の手動掃除（cron 等で実行可）。例として 60 日より古い行を削除。
--   delete from enger.ai_cache where created_at < now() - interval '60 days';

-- 確認
-- select feature, count(*) from enger.ai_cache group by feature;
