-- referral-portal-v2.sql
-- 紹介元ポータル(/ref) 第2弾：お試し企業向けの双方向マッチング＋良い/わるい判定。
--   ・kind    : 判定の向き（cand_job=人材→案件 / job_cand=案件→人材）
--   ・verdict : 'want'（良い＝進めたい） / 'pass'（わるい＝見送り）。再判定で上書き可。
--   既存の unique (partner_id, candidate_no, job_no) を判定の一意キーとして流用する。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。

alter table enger.referral_requests add column if not exists kind text not null default 'cand_job';
alter table enger.referral_requests add column if not exists verdict text not null default 'want';
alter table enger.referral_requests add column if not exists updated_at timestamptz not null default now();

comment on column enger.referral_requests.kind is '判定の向き（cand_job=紹介人材×案件 / job_cand=紹介案件×人材）';
comment on column enger.referral_requests.verdict is '紹介元の判定（want=進めたい / pass=見送り）。再判定で上書きされる';
