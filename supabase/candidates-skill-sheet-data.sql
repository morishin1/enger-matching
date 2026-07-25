-- ============================================================
-- 0725：人材マスタに「構造化スキルシート」列を追加（enger.candidates.skill_sheet_data）。
--   enger.jp（/signup・/skill-sheet/excel）や coo.enger.jp のスキルシート入力内容を
--   JSON で保持し、dx の人材一覧・マッチング画面でエージェントが閲覧できるようにする。
--   形は coo の SkillSheetInput と互換：
--     { name, title, careerSummary, skills[], projects[{ name, periodStart, periodEnd,
--       industry, jobtype, tasks, result, role, scale, workstyle,
--       languages, serverOs, tools, phases[] }], ... }
--   中央 Supabase の SQL Editor で実行（冪等・何度でも安全）。
-- ============================================================

alter table enger.candidates add column if not exists skill_sheet_data jsonb;

comment on column enger.candidates.skill_sheet_data is
  '構造化スキルシート（enger.jp / coo.enger.jp の入力内容）。人材一覧のビューアで表示。coo SkillSheetInput 互換';

-- ── 後追い反映（任意・実行推奨） ─────────────────────────────

-- ① enger.jp（LP）登録者：public.profiles.skill_sheet_data を email 突合で反映（未設定のみ）。
--    ※ 先に enger-lp/supabase/profiles-skill-sheet-data.sql を実行しておくこと。
update enger.candidates c
set skill_sheet_data = p.skill_sheet_data
from public.profiles p
where c.skill_sheet_data is null
  and p.skill_sheet_data is not null
  and c.email is not null
  and lower(c.email) = lower(p.email);

-- ② coo.enger.jp 取込済みの人材：coo_talent_entries.payload を反映（未設定のみ）。
update enger.candidates c
set skill_sheet_data = e.payload
from public.coo_talent_entries e
where e.imported_candidate_id = c.id
  and e.status = 'imported'
  and e.payload is not null
  and c.skill_sheet_data is null;

-- 確認用：
-- select candidate_no, name, jsonb_array_length(coalesce(skill_sheet_data->'projects', '[]'::jsonb)) as projects
-- from enger.candidates where skill_sheet_data is not null order by candidate_no desc limit 20;
