-- ============================================================
-- #367：面談済み後のプロフィール編集ロック（本人編集の禁止）＋ dx 管理者による解除。
--
--   ロック判定（enger-lp /api/profile/save と /profile 画面で使用）:
--     locked = agent_meeting_done_at IS NOT NULL AND NOT profile_edit_unlocked
--   ・面談済（DX の面談済チェック → agent_meeting_done_at セット）になると
--     フリーランス本人は LP でプロフィールを編集できなくなる。
--   ・dx の管理者（role=admin）だけが profile_edit_unlocked=true で解除できる
--     （面談済チェック自体は外さない＝LP の案件閲覧解禁は維持したままロックだけ外す）。
--   ・DX スタッフ（admin/agent）によるプロフィール編集はこのロックの対象外
--     （updateFreelanceProfile はサービスロールで直接書く）。
--   ※ 中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table public.profiles add column if not exists profile_edit_unlocked boolean not null default false;

comment on column public.profiles.profile_edit_unlocked is
  '#367：面談済み後の本人編集ロックの解除フラグ。true=面談済みでも本人が編集可（dx管理者が設定）。既定 false';

-- 確認用：
-- select id, display_name, agent_meeting_done_at, profile_edit_unlocked
--   from public.profiles where agent_meeting_done_at is not null limit 20;
