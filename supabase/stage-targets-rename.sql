-- メンバー別ステージ目標ボードの列名変更に伴う既存目標の引継ぎ。
--   「所属確認」→「打ち合わせ」、「確認中」→「案件の仕入れ」。
--   ※ 列の意味（現在値のソース）も変わるが、目標値はそのまま引き継いで運用できるよう改名する。
--   ※ 新名の行が既に存在する場合は重複を避けてスキップ（古い行は残置）。
begin;

update enger.stage_targets t
   set stage = '打ち合わせ'
 where t.stage = '所属確認'
   and not exists (select 1 from enger.stage_targets x where x.owner_name = t.owner_name and x.stage = '打ち合わせ');

update enger.stage_targets t
   set stage = '案件の仕入れ'
 where t.stage = '確認中'
   and not exists (select 1 from enger.stage_targets x where x.owner_name = t.owner_name and x.stage = '案件の仕入れ');

commit;

-- 確認用：
--   select owner_name, stage, target from enger.stage_targets order by owner_name, stage;
