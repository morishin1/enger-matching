-- ============================================================
-- 受託開発・エンド（enger.companies.is_end_client）— 管理NO #491
--
--   SES の商流を挟まず、自社で受託開発を行う／エンドユーザー企業であることを示すフラグ。
--   ・企業管理の一覧で絞り込める（「受託開発・エンド」フィルタ）
--   ・案件一覧のクライアント名の横にマークが出る（商流の深さが一目で分かる）
--
--   中央 Supabase の SQL Editor で実行する（冪等・何度でも安全）。
-- ============================================================

-- ① 列の追加
--    is_end_client  : true = 受託開発・エンド
--    end_client_at  : 設定日時（誰がいつ付けたかを残す。caution / ng と同じ方針）
--    end_client_by  : 設定者（氏名）
alter table enger.companies
  add column if not exists is_end_client boolean not null default false,
  add column if not exists end_client_at timestamptz,
  add column if not exists end_client_by text;

-- 絞り込みは「true のものだけ」なので部分インデックスで十分（companies_ng_idx と同じ形）
create index if not exists companies_end_client_idx
  on enger.companies (is_end_client) where is_end_client = true;

comment on column enger.companies.is_end_client is
  '受託開発・エンド企業フラグ（#491）。企業管理のフィルタと案件一覧のマークに使用。';

-- ============================================================
-- ② 対象29社の登録とフラグ付け（#491 ①②）
--
--   ・未登録の企業は新規登録する。company_no（企業ID）は
--     `generated always as identity` なので **自動採番される**（手動採番は不要）
--   ・既に登録済みの企業は is_end_client だけを立てる。
--     name 以外の列は触らないので、業種・担当・メモ等の既存入力は壊れない
--   ・companies_name_uniq（companies-extend.sql）が name の一意制約
--
--   ※ このブロックは何度実行しても結果が変わらない（フラグが true になるだけ）。
-- ============================================================
insert into enger.companies as c (name, is_end_client, end_client_at, end_client_by)
select v.name, true, now(), 'システム投入（#491）'
from (values
  ('株式会社日本テクノウエア'),
  ('イーソル株式会社'),
  ('株式会社フレクト'),
  ('株式会社EVERRISE'),
  ('株式会社アイソルート'),
  ('株式会社ウィナス'),
  ('株式会社Freewill'),
  ('株式会社Meaning Live'),
  ('株式会社エクソナ'),
  ('株式会社エクセル・システムプロダクト'),
  ('株式会社コンテンツワン'),
  ('スマートソーシャル株式会社'),
  ('株式会社Bartholojapan'),
  ('株式会社CMSENS'),
  ('株式会社G&T'),
  ('株式会社グローバー'),
  ('株式会社メドコム'),
  ('株式会社BRIXIT'),
  ('株式会社ALT'),
  ('サウンズ株式会社'),
  ('ビジネスエンジニアリング株式会社'),
  ('株式会社個別教育研究所'),
  ('株式会社Nuco'),
  ('株式会社スリーアイズ'),
  ('株式会社スーパーソフトウェア'),
  ('Fabeee株式会社'),
  ('株式会社モンスター・ラボ'),
  ('ストリクス株式会社'),
  ('スパイラルセンス株式会社')
) as v(name)
on conflict (name) do update
  -- 既存企業は「チェックだけ入れる」（#491 補足）。他の列は一切上書きしない。
  set is_end_client = true,
      end_client_at = coalesce(c.end_client_at, now()),
      end_client_by = coalesce(c.end_client_by, 'システム投入（#491）');

-- ============================================================
-- 確認用
-- ============================================================
-- 投入した29社が全て入っているか（29 が返れば OK）
-- select count(*) from enger.companies where is_end_client = true;

-- 企業IDが採番されているか
-- select company_no, name, is_end_client, end_client_at
--   from enger.companies where is_end_client = true order by company_no;
