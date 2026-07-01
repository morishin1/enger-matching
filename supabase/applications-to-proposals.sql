-- ============================================================
-- 応募 → 提案ボード自動記録（ENGERフリーランスの応募時のみ提案管理に反映）
--   要件：
--     ・チャット/スカウト等のフリーランスとのやり取りでは提案ボードへ記録しない。
--     ・フリーランスが enger.jp（LP）から「応募」した時のみ、提案ボードの
--       「所属確認」フォルダに〈対象案件＋人材名〉を表示する。
--   仕組み：enger.applications への INSERT 時に、対応する提案が無ければ
--           enger.proposals に stage='所属確認' で1件作成する（冪等）。
--   ※ 中央 Supabase の SQL Editor で実行（何度でも安全・冪等）。
--   ※ dx 側の createApplication でも同等の提案を best-effort で作成するため、
--      本トリガ未適用でも dx 起票の応募は提案ボードに載る。本トリガは LP 直起票の
--      応募（dx を経由しない経路）を確実に拾うために必要。
-- ============================================================

create or replace function enger.application_to_proposal() returns trigger
  language plpgsql security definer as $$
declare
  v_company   text;
  v_title     text;
  v_cand_id   uuid;
  v_cand_name text;
  v_cand_init text;
begin
  v_title := coalesce(nullif(btrim(new.job_title), ''), '（応募）');

  -- #250：応募者(engineer_id)が人材マスタへ登録済み（E番号↔P番号 紐付けあり）なら、その P番号(candidate)を判別。
  --   迷子にならないよう、提案レコードに candidate_id / 人材名(マスタ) / イニシャル を結びつける。
  begin
    select l.candidate_id, c.name, coalesce(c.initials, left(coalesce(c.name,''),2))
      into v_cand_id, v_cand_name, v_cand_init
      from enger.freelance_candidate_links l
      join enger.candidates c on c.id = l.candidate_id
     where l.engineer_id = new.engineer_id
     limit 1;
  exception when others then v_cand_id := null;
  end;

  -- 表示用の人材名は、マスタ登録済みなら P番号側の氏名を優先、無ければ応募スナップショット名。
  v_cand_name := coalesce(v_cand_name, new.engineer_name);
  v_cand_init := coalesce(v_cand_init, left(coalesce(new.engineer_name, ''), 2));

  -- 既に同一応募の提案があればスキップ（二重作成防止）。
  --   マスタ紐付けがあれば candidate_id×案件名 で、無ければ 人材名×案件名×LP直接応募 で判定。
  if (v_cand_id is not null and exists (
        select 1 from enger.proposals p
        where p.candidate_id = v_cand_id and coalesce(p.job_title,'') = v_title
          and coalesce(p.next_action,'') like '%直接応募%'))
     or exists (
        select 1 from enger.proposals p
        where coalesce(p.candidate_name, '') = coalesce(new.engineer_name, '')
          and coalesce(p.job_title, '') = v_title
          and coalesce(p.next_action, '') like '%直接応募%')
  then
    return new;
  end if;

  -- 案件先の会社名を補完（任意・取得失敗は null のまま）。
  begin
    if new.job_id is not null then
      select client_name into v_company from enger.jobs where id = new.job_id;
    end if;
  exception when others then v_company := null;
  end;

  -- 提案ボードへ記録（所属確認フォルダ）。next_action に「直接応募」を含め LP直接応募バッジを点ける。
  --   マスタ登録済みなら candidate_id（P番号）を結びつけて一元管理できるようにする。
  begin
    insert into enger.proposals
      (job_id, candidate_id, stage, job_title, company, candidate_name, c_init, proposer, ai, next_action)
    values
      (new.job_id, v_cand_id, '所属確認', v_title, v_company, v_cand_name,
       v_cand_init, null, false, 'エンジニア直接応募（LP）');
  exception when others then
    -- 列差異等で失敗しても応募自体は成立させる（best-effort）。
    null;
  end;

  return new;
end $$;

drop trigger if exists applications_to_proposal on enger.applications;
create trigger applications_to_proposal
  after insert on enger.applications
  for each row execute function enger.application_to_proposal();

-- 確認：
-- insert into enger.applications (engineer_id, engineer_name, job_title, stage)
--   values (gen_random_uuid(), 'テスト 太郎', 'テスト案件', '応募');
-- select stage, job_title, candidate_name, next_action from enger.proposals
--   where next_action like '%直接応募%' order by created_at desc limit 5;
