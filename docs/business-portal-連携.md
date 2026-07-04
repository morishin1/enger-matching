# ENGER business（enger.jp 企業向け画面）メニュー構成・DX連携仕様

> このリポジトリは **dx.enger.jp（社内ツール）専用**です。enger.jp 本体（`morishin1/enger-lp`）の
> 企業向け画面「ENGER business」のメニュー構成と DX 連携の実装仕様をまとめた文書です。
> **enger-lp 側のセッションにこの文書を渡してそのまま実装**できる粒度で書いています。

## 0. 背景・要望（フィードバック元）

現状の enger-lp 企業向けサイドメニュー：

| 現状メニュー | 状態 |
|---|---|
| ダッシュボード | 表示のみ |
| 求人・案件管理 | 準備中 |
| スカウト送信 | 準備中 |
| 候補者・応募者 | 準備中 |
| チャット | 稼働 |
| 会社情報 | 稼働 |

要望：
1. **「会社情報」→「自社情報」に改名**する。
2. マッチングに必要なメニューを追加する。
3. 企業の目的＝**自社案件・自社プロフィールが充実するほどマッチング率が上がる**構成にする。
4. DX（dx.enger.jp）のマッチング機能とよく考えて整合させる。

## 1. 大原則（DXと共通のルール）

- **データの正は DX（Supabase `enger` スキーマ）**。enger-lp は「APIを叩いて表示・入力するだけ」
  （`docs/freelance-job-detail-連携.md` の job-detail 連携と同じ方式）。enger-lp から `enger` スキーマを直接触らない。
- **企業に見せる人材情報は常に匿名**（イニシャル＋スキル＋単価。氏名・連絡先は担当が仲介）。
- 企業→人材への**直接スカウトは行わない**。「会いたい」フィードバックを担当（ENGER営業）が受けて仲介する。
  → 単独メニュー「スカウト送信」は廃止し、「おすすめ人材」内のアクションに統合する（§2参照）。
- **面談済ゲート**：担当エージェントとの面談完了（`app_users.meeting_done`）までは、
  おすすめ人材は「匿名・マッチ度のみのランキング」、選考管理・詳細閲覧・「会いたい」アクションは面談後に解放
  （DX企業ポータルと同一ポリシー）。

## 2. メニュー構成（確定案）

| # | メニュー | 現状からの変更 | 内容 | DX側の対応画面 |
|---|---|---|---|---|
| 1 | ダッシュボード | 内容強化 | マッチングサマリ＋**充実度メーター**（§3） | `/`（ClientHome） |
| 2 | 自社案件 | 「求人・案件管理」を改名・稼働化 | 自社案件の掲載・編集・審査状況・提案/応募数 | `/portal/jobs` |
| 3 | おすすめ人材 | **新設**（マッチングの中核） | AIマッチした人材（匿名）をマッチ度＋一致スキルの根拠つきで表示。「会いたい / 検討中 / ミスマッチ」の評価で精度向上＆担当が面談調整 | `/portal/candidates` |
| 4 | 選考管理 | 「候補者・応募者」を改名・稼働化 | 自社案件への応募者＋ご提案中の候補者のステージ管理（匿名イニシャル） | `/portal/selection` |
| 5 | チャット | 現状維持 | 担当（ENGER運営）との連絡窓口 | —（LP側完結） |
| 6 | **自社情報** | 「会社情報」を**改名**・内容拡張 | 会社基本情報＋採用プロフィール（Mission・カルチャー・求める人物像・自社の魅力・サイトURL）＋充実度表示 | `/portal/company` |

- 「スカウト送信」は**メニューから削除**。匿名原則のため企業からの直接スカウトは提供せず、
  「おすすめ人材」の**「会いたい」ボタン＝スカウト依頼**として担当が仲介する。
  依頼状況（会いたい済みの人材と進捗）は「おすすめ人材」内で見える化する。
- この構成は DX のマッチングエンジン（案件×人材のスキルマッチ＋AI再ランク。`company_profiles` の
  Mission等も訴求・適合判断に使用）と 1:1 で対応しており、**自社案件と自社情報が入力の起点**になる。

## 3. ダッシュボード「充実度メーター」仕様

自社案件・自社情報が揃うほどマッチング精度と提案数が上がることを常時見える化し、入力へ誘導する。
DX の ClientHome（企業ポータルのホーム）にも同一ロジックで実装済み（`src/components/ClientHome.tsx`）。

- 算出：**計6ステップ** ＝ 自社情報5項目（mission / culture / ideal_persona / appeal / website の非空）
  ＋ 自社案件1件以上。`充実度% = round(達成ステップ数 / 6 × 100)`。
- 表示：進捗バー＋未達成項目へのリンクチップ（「自社情報を入力（n/5 項目）」「自社案件を1件以上掲載」）。
  100% のときは「準備OK！ 貴社に合う人材を優先的にご提案します。」のみ表示。

## 4. フェーズ分け

### Phase 1（enger-lp のみで完結・DX側の追加実装は不要）

enger.jp と dx.enger.jp は **同じ Supabase Auth を共有**しており、ビジネスアカウントには
`app_metadata.apps` に `business` フラグが付与されている（`src/lib/auth-apps.ts`）。
ログイン済みの企業ユーザーはそのまま dx.enger.jp の企業ポータルを開ける。

1. サイドメニューを §2 の6項目に変更（改名・追加・スカウト送信の削除）。
2. 準備中だった各メニューは、当面 **dx.enger.jp の対応画面へのリンク**にする：
   - 自社案件 → `https://dx.enger.jp/portal/jobs`
   - おすすめ人材 → `https://dx.enger.jp/portal/candidates`
   - 選考管理 → `https://dx.enger.jp/portal/selection`
   - 自社情報 → `https://dx.enger.jp/portal/company`（LP内に会社基本情報の画面を残す場合は、
     採用プロフィール（Mission等）のみ dx へリンクでも可）
3. ダッシュボードに §3 の充実度メーターを表示（Phase 1 では下記 `overview` API がまだ無いため、
   固定の説明カード＋dxへのリンクでも可。メーターの実表示は Phase 2 で）。

### Phase 2（LP内でネイティブ実装する場合：DX公開APIを追加）

DX に `/api/public/biz/*` を追加し、enger-lp がネイティブ画面を実装する。
**この節のAPIは未実装**。実装時は `src/app/api/public/job-detail/route.ts` の方式
（Bearer トークン検証・サーバ側ホワイトリスト・`*.enger.jp` CORS 許可）を踏襲する。

共通仕様：
```
Authorization: Bearer <Supabaseアクセストークン>（必須）
会社の特定：トークンの email → enger.app_users（role=client）の company を採用。
           client 以外のロール・未承認アカウントは 403。
CORS: enger 系オリジン（*.enger.jp）のみ許可。
レスポンスはホワイトリスト方式（下記に無い項目はDBにあっても返さない）。
```

| メソッド/パス | 用途 | 主なレスポンス項目 |
|---|---|---|
| `GET /api/public/biz/overview` | ダッシュボード | `jobs`（公開中件数）・`activeProposals`・`interviewing`・`won`・`profileFilled`(0-5)・`readiness`(0-100)・`meetingDone` |
| `GET /api/public/biz/jobs` | 自社案件一覧 | `job_no, title, role_label, skills, salary_min/max, remote_type, status, review_status, is_published, proposalCount, applicantCount` |
| `POST /api/public/biz/jobs` | 案件の掲載申請 | 入力：`title, role_label, skills[], salary_min/max, remote_type, description, contract_types[]`。DXでは `posted_by_client=true, review_status='pending', is_published=false` で作成→運営審査後に公開 |
| `GET /api/public/biz/candidates` | おすすめ人材（匿名） | `proposalId, init（イニシャル）, title（職種）, jobTitle, matchScore, matchedSkills[], rate, stage, feedback`。**氏名・連絡先は絶対に含めない**。未面談時は上位N件のランキング（イニシャル・マッチ度のみ）に制限 |
| `POST /api/public/biz/feedback` | 会いたい/検討中/ミスマッチ | 入力：`proposal_id, verdict('want'|'maybe'|'mismatch'), reason?` → `enger.client_feedback` に upsert（DXの担当に通知され、`want` はスカウト依頼として仲介） |
| `GET /api/public/biz/selection` | 選考管理（匿名） | 案件ごとの応募者（`enger.applications`）＋提案candidates のステージ一覧。表示名はイニシャルのみ。**未面談時は 403（meeting gate）** |
| `GET/PUT /api/public/biz/company-profile` | 自社情報 | `mission, culture, ideal_persona, appeal, website`（`enger.company_profiles`。PUT は同項目のみ受理） |

## 5. DX側データ（参照。enger-lp からは直接触らない）

| テーブル | 役割 |
|---|---|
| `enger.jobs` | 案件。企業掲載分は `posted_by_client=true` ＋ `review_status`（pending/approved/rejected）で審査 |
| `enger.proposals` | 提案（マッチ結果）。`ai_match`/`score`＝マッチ度、`c_init`＝匿名イニシャル、`stage`＝選考ステージ |
| `enger.applications` | LP「応募する」経由の応募 |
| `enger.client_feedback` | 企業フィードバック（want/maybe/mismatch。want＝スカウト依頼） |
| `enger.company_profiles` | 自社情報（mission/culture/ideal_persona/appeal/website） |
| `enger.app_users` | アカウント。`role='client'`・`company`・`meeting_done`（面談済ゲート） |

## 6. 今回 DX 側で実装済みの変更（本リポジトリ）

- 企業ポータルの「企業プロフィール」表記を **「自社情報」に統一**（サイドメニュー・トップバー・ページ見出し・ユーザーメニュー）。
- ClientHome（企業ポータルのホーム）に **充実度メーター（§3）** を追加。

## 7. 注意

- enger.jp は別オリジンのため、Phase 2 のAPIは job-detail と同様に CORS 許可が必要。
- 本番反映（enger.jp 画面の変更）は **enger-lp 側の実装・デプロイが必要**（本リポジトリからは変更できない）。
