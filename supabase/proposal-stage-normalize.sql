-- ============================================================
-- 提案ステージ名の正規化  enger.proposals.stage
--
-- 背景（2026-07）:
--   DBに旧ステージ名（提案済 / 返信待ち / 返信あり / 面談調整 / クロージング中 / 面談合格）が
--   残っており、画面ごとに扱いが違うため件数が食い違っていた。
--     ・提案管理 /proposals … 新6種で IN 絞り → 旧名の提案が一覧から消える
--     ・ダッシュボード・分析 … 旧名は含むが 承認待ち/確認中 が抜けていた
--     ・dx.enger（新UI）    … normalizeStage() で旧名を新名へ吸収して表示
--   結果、同じ「提案中」が 36件／48件 のように別の数字になっていた。
--
--   コード側は ACTIVE_STAGES を共通化して当面どちらも拾うようにしたが、
--   **本質的な解決はDBの値を新語彙に寄せること**。それが本ファイル。
--
-- 実行順:
--   1) STEP1 で影響件数を確認（変更しない）
--   2) STEP2 でバックアップ列に退避（初回のみ・冪等）
--   3) STEP3 で更新
--   4) STEP4 で結果を確認
--   問題があれば STEP5 で巻き戻せる。
-- ============================================================

-- ── STEP1: 影響範囲の確認（読み取りのみ。まずこれだけ実行する）──────────
-- 旧名・未知の値がそれぞれ何件あるかを出す。ここが 0 件なら移行は不要。
select
  coalesce(nullif(trim(stage), ''), '(空)') as 現在のstage,
  count(*)                                  as 件数,
  case
    when trim(stage) in ('承認待ち','所属確認','提案中','確認中','面談','合格') then '新（そのまま）'
    when trim(stage) in ('提案済','返信待ち','返信あり')                        then '旧 → 提案中'
    when trim(stage) in ('面談調整','クロージング中')                            then '旧 → 面談'
    when trim(stage) = '面談合格'                                                then '旧 → 合格'
    when trim(stage) in ('見送り','失注','稼働','稼働決定','稼働中')             then '終端（対象外）'
    else '未知 → 要確認'
  end                                       as 判定
from enger.proposals
group by 1, 3
order by 3, 2 desc;

-- 「未知 → 要確認」に該当する行の中身（あれば個別に判断する。空なら以降は安全に流せる）
select id, stage, created_at, updated_at
from enger.proposals
where coalesce(nullif(trim(stage), ''), '') not in (
  '承認待ち','所属確認','提案中','確認中','面談','合格',
  '提案済','返信待ち','返信あり','面談調整','クロージング中','面談合格',
  '見送り','失注','稼働','稼働決定','稼働中'
)
order by created_at desc
limit 50;


-- ── STEP2: 退避（冪等。巻き戻し用に元の値を残す）──────────────────
alter table enger.proposals add column if not exists stage_legacy text;

update enger.proposals
   set stage_legacy = stage
 where stage_legacy is null
   and trim(coalesce(stage, '')) in
       ('提案済','返信待ち','返信あり','面談調整','クロージング中','面談合格');


-- ── STEP3: 正規化（旧名 → 新名）────────────────────────────────
-- 終端ステージ（見送り/失注/稼働…）と未知の値は触らない。
-- 未知の値をここで一括変換しないのは、アプリ側の default が「所属確認」に
-- 落としてしまい実態と違う集計になるため（まず STEP1 で中身を見て個別に判断する）。
update enger.proposals set stage = '提案中'
 where trim(coalesce(stage, '')) in ('提案済','返信待ち','返信あり');

update enger.proposals set stage = '面談'
 where trim(coalesce(stage, '')) in ('面談調整','クロージング中');

update enger.proposals set stage = '合格'
 where trim(coalesce(stage, '')) = '面談合格';


-- ── STEP4: 結果確認（旧名が 0 件になっていること）──────────────────
select coalesce(nullif(trim(stage), ''), '(空)') as stage, count(*) as 件数
from enger.proposals
group by 1
order by 2 desc;

-- 移行した件数（stage_legacy に値がある行）
select stage_legacy as 移行前, stage as 移行後, count(*) as 件数
from enger.proposals
where stage_legacy is not null
group by 1, 2
order by 3 desc;


-- ── STEP5: 巻き戻し（必要なときだけ実行）────────────────────────
-- update enger.proposals set stage = stage_legacy, stage_legacy = null
--  where stage_legacy is not null;


-- ============================================================
-- 移行後にやること（コード側の後片付け）
--   src/lib/proposal-constants.ts の ACTIVE_STAGES から LEGACY_STAGES を外し、
--   normalizeStage() の旧名 case も削除できる。
--   dx.enger（別リポジトリ）の src/lib/proposal-stages.ts も同様。
--   ※ 外す前に STEP4 で旧名が 0 件であることを必ず確認する。
-- ============================================================
