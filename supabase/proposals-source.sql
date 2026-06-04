-- 提案カードの「登録元」(line / enger / mail) を保持。
-- 一目で流入経路が分かるよう、カードのアイコン・色に使う（ステージが進んでも色は変えない）。
alter table enger.proposals add column if not exists source text;

-- 企業マスタ側に窓口担当・自社担当の列が無ければ追加（提案カードから紐づけ保存できるように）。
alter table enger.companies add column if not exists contact_name text;
alter table enger.companies add column if not exists owner_staff  text;
