-- ============================================================
-- ENGER v2 Matching — デモ用サンプルデータ (companies / candidates / proposals)
--   実CSV取込までの間、企業/人材/進捗 画面を実データで表示するための種データ。
--   何度実行しても重複しないよう code でユニーク扱い (on conflict do nothing)。
--   中央 Supabase の SQL Editor で実行。
-- ============================================================

-- 企業
insert into enger.companies (code, name, initials, tier, industry, active_jobs, last_deals, total_revenue, owner, owner_init, status, last_activity, relation, color, note) values
('C-001','三菱UFJ系SIer','MU','A','金融システム',6,4,'¥142M','佐々木','SA','主要','3時間前',92,'#0095D9','決済基盤 / 勘定系 を中心に長期で依頼'),
('C-002','アパレル大手 A','AP','A','小売 / EC',4,9,'¥98M','高橋','TM','主要','昨日',88,'#3f634d','EC リシステム React 移行を中心に'),
('C-003','通信キャリア子会社','TC','A','通信 / IT',5,7,'¥86M','渡辺','WS','拡大中','5/19',85,'#7a5cc4','データ基盤 Snowflake / dbt 案件が広がる'),
('C-004','メディアSTU','MS','B','メディア',2,3,'¥32M','佐々木','SA','主要','昨日',78,'#d97a3a','スタートアップ / iOS · React Native 案件中心'),
('C-005','大手物流','LG','B','物流',3,6,'¥54M','高橋','TM','主要','5/18',72,'#5a9b6a','.NET / 業務系 中心、改修多め'),
('C-006','SaaS BtoB スタッフ','SB','B','SaaS',2,1,'¥18M','渡辺','WS','新規','5/14',65,'#0095D9','SRE / K8s 移行、長期見込み'),
('C-007','FinTechスタートアップ','FT','B','FinTech',1,2,'¥28M','高橋','TM','主要','5/16',70,'#3d7fa8','進行中 1 件 / 継続検討'),
('C-008','電力業界子会社','EP','C','インフラ',1,3,'¥21M','佐々木','SA','主要','5/13',60,'#c9a73a','長い付き合い / 規模小さめだが安定'),
('C-009','コンサル大手','CN','C','コンサル',0,2,'¥14M','高橋','TM','休眠','4/22',42,'#94a3b8','3 ヶ月間連絡なし / 要フォロー'),
('C-011','医療系 SaaS','MH','B','ヘルスケア',2,0,'¥12M','佐々木','SA','新規','5/20',68,'#5a9b6a','初取引 / 2 案件進行中')
on conflict (code) do nothing;

-- 人材
insert into enger.candidates (code, name, initials, title, exp, company, rate, rate_num, avail, location, skills, score, why, status, saved) values
('P-04127','中村 拓海','NT','バックエンドリード / 金融基盤','12y','フリーランス','¥90万',90,'6/01〜','東京', array['Java','Spring','Kafka','AWS','金融'], 96, array['Java 17 + Spring Boot ✓','金融基盤 8年 ✓','希望単価 一致','読み書き英語 ✓'], '提案可', true),
('P-04138','鈴木 一樹','SK','シニアエンジニア','9y','パートナーA','¥85万',85,'6/15〜','リモート', array['Java','AWS','Kafka','SRE'], 91, array['AWS 認定 ✓','Kafka 運用 5年 ✓','稼働開始やや遅め △'], '提案中', true),
('P-04201','高橋 翔','TS','フルスタック / FinTech','7y','パートナーB','¥82万',82,'6/01〜','東京', array['Java','React','AWS','決済'], 88, array['決済領域 3年 ✓','Spring 経験あり ✓','リードPjM 未経験 △'], '提案可', false),
('P-04088','佐藤 千夏','ST','バックエンド / データ寄り','8y','パートナーA','¥78万',78,'6/01〜','リモート', array['Java','Snowflake','dbt'], 84, array['Java 経験 6年 ✓','Kafka 未経験 ✗','希望単価 やや低め ✓'], '提案可', false),
('P-04222','原田 真希','HM','バックエンド / 業務系','6y','フリーランス','¥75万',75,'7/01〜','東京', array['Java','Spring','AWS'], 80, array['Spring Boot 3年 ✓','金融未経験 △','稼働開始遅め △'], '提案可', false),
('P-04305','森 健介','MK','PjM / 金融基盤','14y','パートナーC','¥100万',100,'6/01〜','東京', array['PjM','金融','Java'], 78, array['金融基盤 10年 ✓','Java 実装距離あり △','単価上振れ △'], '提案可', false),
('P-04412','井上 さくら','IS','Kafka スペシャリスト','7y','フリーランス','¥88万',88,'6/15〜','リモート', array['Kafka','Java','SRE'], 76, array['Kafka 5年 ✓','金融未経験 △'], '提案可', false)
on conflict (code) do nothing;

-- 提案・進捗
insert into enger.proposals (code, stage, job_title, company, candidate_name, c_init, rate, score, owner, owner_init, due, due_t, days_in, next_action, ai) values
('PR-411','新規提案','決済基盤 / BE リード','三菱UFJ系SIer','中村 拓海','NT','¥90万',96,'佐々木','SA','今日 17:00','danger',1,'提案メール送信',true),
('PR-410','新規提案','EC React 移行 PM','アパレル大手 A','平野 翔','HS','¥82万',93,'高橋','TM','5/22 12:00','warn',1,'提案資料作成',true),
('PR-409','新規提案','Snowflake データ基盤','通信キャリア子会社','佐藤 千夏','ST','¥78万',91,'渡辺','WS','5/23','',1,'初回説明',true),
('PR-405','提案中','FinTech BE 開発','三菱UFJ系SIer','高橋 翔','TS','¥82万',88,'佐々木','SA','5/24','warn',4,'先方担当の返信待ち',false),
('PR-404','提案中','iOS Swift 刷新','メディアSTU','鈴木 一樹','SK','¥75万',84,'佐々木','SA','5/26','',5,'質問への回答',false),
('PR-402','提案中','SRE / K8s 移行','SaaS BtoB スタッフ','井上 さくら','IS','¥88万',79,'渡辺','WS','5/28','',6,'社内評議待ち',false),
('PR-391','面談調整','決済基盤 / BE リード','三菱UFJ系SIer','中村 拓海','NT','¥90万',96,'佐々木','SA','明日 10:00','warn',2,'一次面談 セットアップ',false),
('PR-390','面談調整','EC React 移行','アパレル大手 A','平野 翔','HS','¥82万',93,'高橋','TM','5/24','warn',3,'二次面談 社内調整',false),
('PR-381','条件交渉','決済基盤 / BE','三菱UFJ系SIer','鈴木 一樹','SK','¥85万',91,'佐々木','SA','5/24','warn',8,'単価調整 ±¥5万',false),
('PR-380','条件交渉','PM / Fintech','FinTechスタートアップ','森 健介','MK','¥100万',88,'高橋','TM','5/27','',6,'契約期間 調整',false),
('PR-371','成約間近','決済基盤 / BE','三菱UFJ系SIer','中村 拓海','NT','¥90万',96,'佐々木','SA','今週中','',12,'最終オファー 提示',false),
('PR-370','成約間近','EC React 移行','アパレル大手 A','平野 翔','HS','¥82万',93,'高橋','TM','5/26','warn',10,'契約書 送付',false)
on conflict (code) do nothing;
