-- referral-partners.sql
-- 紹介元ポータル：知り合い企業（人材を紹介してくれる会社）に、会員登録なしの
-- 簡易ログイン（ID＋パスコード）で「自社が紹介した人材」と「その人材にマッチする案件」
-- だけを見せるための台帳（/ref）。
--   ・アカウント（Supabase Auth）は作らない。担当が企業管理から発行し、ID/パスコードを口頭・メールで渡す。
--   ・パスコードは平文で保存しない（HMAC-SHA256 のハッシュのみ。発行時に一度だけ表示）。
--   ・人材との紐付けは candidates.source_company（取込元SES会社名）/ owner_company との照合。
--   ・案件のクライアント企業名は見せない（担当仲介まで非公開＝直接取引の防止）。

create table if not exists enger.referral_partners (
  id uuid primary key default gen_random_uuid(),
  login_id text not null unique,              -- 簡易ログインID（例: REF-1234）
  passcode_hash text not null,                -- HMAC-SHA256(secret, login_id:passcode)
  company_name text not null,                 -- 紹介元企業名（companies.name / candidates.source_company と照合）
  created_by text,                            -- 発行した担当（名前 or メール）
  created_at timestamptz not null default now(),
  expires_at timestamptz,                     -- 有効期限（既定は発行から90日。null=無期限）
  revoked_at timestamptz,                     -- 停止（担当がいつでも失効できる）
  failed_attempts int not null default 0,     -- ログイン連続失敗（上限超過で自動ロック）
  view_count int not null default 0,
  last_viewed_at timestamptz
);

create index if not exists referral_partners_company_idx on enger.referral_partners (company_name);

-- 「この案件で進めてほしい」依頼の記録（担当への通知と重複防止に使う）
create table if not exists enger.referral_requests (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references enger.referral_partners(id) on delete cascade,
  candidate_no int,
  job_no int,
  created_at timestamptz not null default now(),
  unique (partner_id, candidate_no, job_no)
);

-- 読み書きはサーバ専用（service_role）。anon には開けない（他社人材・案件の漏洩防止）。
grant all on enger.referral_partners to service_role;
grant all on enger.referral_requests to service_role;

comment on table enger.referral_partners is '紹介元ポータル（/ref）の簡易ログイン台帳。会員登録なしで紹介人材×マッチ案件だけを見せる';
comment on column enger.referral_partners.passcode_hash is 'パスコードのHMACハッシュ（平文は保存しない。発行時に一度だけ表示）';
comment on column enger.referral_partners.company_name is '紹介元企業名。candidates.source_company / owner_company と照合して「自社が紹介した人材」を絞り込む';
comment on table enger.referral_requests is '紹介元からの「この案件で進めてほしい」依頼（partner×人材×案件で一意）';
