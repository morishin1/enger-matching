-- 失注理由メモ列。失注理由が「E3: その他」のとき、分析の手がかりとして自由記述メモを必須化する。
--   - 既存運用は壊さず、対応UIだけ「E3 を選んだ場合は note を必須」とする。
alter table enger.proposals add column if not exists lost_reason_note text;
comment on column enger.proposals.lost_reason_note is '失注理由の補足メモ。失注理由が「E3: その他」の場合は入力必須（UIで強制）。';
