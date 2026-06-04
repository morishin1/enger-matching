-- ============================================================
-- 書類送付の期限管理  enger.document_tasks  (冪等)
--   上位/下位 × 書類種別 × 送付期限 × 送付状況 を手動で管理するチェック表。
--   契約書類（基本契約/個別契約/注文書/注文請書/NDA 等）の送付漏れ・期限超過を防ぐ。
--   現状は手動登録。将来は稼働(engagements)から自動生成も検討。
-- ============================================================

create table if not exists enger.document_tasks (
  id            uuid primary key default gen_random_uuid(),
  party         text not null default '上位',  -- '上位' | '下位'（相手の立場）
  counterparty  text,                           -- 相手企業名
  subject       text,                           -- 関連（案件/人材など・任意の自由記述）
  doc_type      text not null default '契約書', -- 書類種別（契約書/注文書/注文請書/基本契約書/個別契約書/秘密保持契約書/その他）
  due_date      date,                           -- 送付期限
  status        text not null default '未送付', -- 未送付 / 送付済 / 完了
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists document_tasks_due_idx    on enger.document_tasks (due_date);
create index if not exists document_tasks_status_idx on enger.document_tasks (status);

-- RLS: 公開読み取り（社内ツール前提）/ 書き込みは service_role のみ
alter table enger.document_tasks enable row level security;
drop policy if exists document_tasks_read on enger.document_tasks;
create policy document_tasks_read on enger.document_tasks for select using (true);
grant select on enger.document_tasks to anon, authenticated;
grant all    on enger.document_tasks to service_role;

-- 確認
-- select party, counterparty, doc_type, due_date, status, note
--   from enger.document_tasks order by due_date nulls last;
