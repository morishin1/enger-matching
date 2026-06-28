-- ============================================================
-- 操作ログ — enger.activity_logs
--   提案（マッチングレコード）の削除・修正など「誰が・いつ・何をしたか」を記録する。
--   提案削除の承認制を廃止する代わりに、操作の追跡性をこのログで担保する。
--   設定 →「ログ」タブで一覧表示。中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

create table if not exists enger.activity_logs (
  id             uuid primary key default gen_random_uuid(),
  operator       text,                          -- 担当者（氏名 or メール）
  operator_email text,                          -- 識別用メール
  action         text not null,                 -- 何をしたか（例：提案を削除 / ステージ変更 / 提案を編集）
  target_type    text,                          -- 対象種別（proposal 等）
  target_id      text,                          -- 対象ID
  target_label   text,                          -- 対象の表示名（候補者 × 案件 等）
  detail         text,                          -- 詳細（削除理由・変更内容 等）
  created_at     timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on enger.activity_logs (created_at desc);

-- 社内専用ログ（担当者名・対象案件名を含む）。anon/フリーランスには一切見せない。
--   読み書きとも dx サーバの service_role 経由に限定（chat_thread_memos と同方針）。
alter table enger.activity_logs enable row level security;
revoke all on enger.activity_logs from anon, authenticated;
grant all on enger.activity_logs to service_role;

-- 確認
-- select created_at, operator, action, target_label, detail from enger.activity_logs order by created_at desc limit 50;
