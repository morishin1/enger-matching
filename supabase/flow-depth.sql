-- 商流の「深さ」を構造化するための拡張。
--   ・jobs.accept_flow_depth  : 案件の受入上限（0=エイトまで/PPのみ・1=一社先まで・2=二社先まで・null=不明）
--   ・candidates.flow_depth   : 人材の階層深さ（0=PP・1=一社下・2=二社下以降・null=不明）
--
--   既存の jobs.flow_note / candidates.affiliation はそのまま残し、自動推定の入力としても使う。
--   担当が手で埋めた値（このカラム）が自動推定より優先される。

alter table enger.jobs
  add column if not exists accept_flow_depth smallint;

alter table enger.candidates
  add column if not exists flow_depth smallint;

-- 0/1/2/null のいずれかに限定（誤入力防止）。
do $$ begin
  alter table enger.jobs add constraint jobs_accept_flow_depth_chk check (accept_flow_depth is null or accept_flow_depth between 0 and 2);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table enger.candidates add constraint candidates_flow_depth_chk check (flow_depth is null or flow_depth between 0 and 2);
exception when duplicate_object then null; end $$;

comment on column enger.jobs.accept_flow_depth      is '案件の受入商流上限。0=エイトまで(PPのみ) 1=一社先まで 2=二社先まで null=不明';
comment on column enger.candidates.flow_depth       is '人材の階層深さ。0=PP(プロパー) 1=一社下 2=二社下以降 null=不明';
