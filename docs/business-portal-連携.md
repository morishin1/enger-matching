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

> **重要（シェル統一済み）**：enger-lp #96 で**シェル統一が完了**しているため、enger.jp の企業ユーザーは
> **dx 側のシェル（このリポジトリの `src/components/Sidebar.tsx` の `CLIENT_NAV`）を見る**。
> したがって、この6項目メニューは **enger-lp 側でメニューを作り直す作業ではなく、dx 側の `CLIENT_NAV` が正**。
> 下表の「対応画面」は実際の描画先そのもの。

| # | メニュー | 現状からの変更 | 内容 | DX側の対応画面（= 実描画） |
|---|---|---|---|---|
| 1 | ダッシュボード | 「ホーム」を改称・内容強化 | マッチングサマリ＋**充実度メーター**（§3） | `/`（ClientHome） |
| 2 | 自社案件 | 「求人・案件管理」を改名・稼働化 | 自社案件の掲載・編集・審査状況・提案/応募数 | `/portal/jobs` |
| 3 | おすすめ人材 | **新設**（マッチングの中核） | AIマッチした人材（匿名）をマッチ度＋一致スキルの根拠つきで表示。「会いたい / 検討中 / ミスマッチ」の評価で精度向上＆担当が面談調整 | `/portal/candidates` |
| 4 | 選考管理 | 「候補者・応募者」を改名・稼働化 | 自社案件への応募者＋ご提案中の候補者のステージ管理（匿名イニシャル） | `/portal/selection` |
| 5 | チャット | **enger-lp の既存チャットへ外部リンク** | 担当（ENGER運営）との連絡窓口。dx シェルからは別タブで enger-lp のチャットを開く | enger-lp（外部・`NEXT_PUBLIC_LP_CHAT_URL`） |
| 6 | **自社情報** | 「会社情報」を**改名**・内容拡張 | 会社基本情報＋採用プロフィール（Mission・カルチャー・求める人物像・自社の魅力・サイトURL）＋充実度表示 | `/portal/company` |

- 「スカウト送信」は**メニューから削除**。匿名原則のため企業からの直接スカウトは提供せず、
  「おすすめ人材」の**「会いたい」ボタン＝スカウト依頼**として担当が仲介する。
  依頼状況（会いたい済みの人材と進捗）は「おすすめ人材」内で見える化する。
- **チャット**は enger-lp 側の既存機能を活かし、dx の `CLIENT_NAV` からは**外部リンク（別タブ）**で導線を残す。
  リンク先URLは環境変数 **`NEXT_PUBLIC_LP_CHAT_URL`** で設定する（未設定時の既定 `https://enger.jp/business/chat` は**要確認**）。
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

### Phase 1（シェル統一）＝ **完了済み（enger-lp #96）**

enger.jp と dx.enger.jp は **同じ Supabase Auth を共有**しており、ビジネスアカウントには
`app_metadata.apps` に `business` フラグが付与されている（`src/lib/auth-apps.ts`）。
enger-lp #96 の**シェル統一**により、ログイン済みの企業ユーザーは dx 側のシェル（`CLIENT_NAV`）と
企業ポータル（`/portal/*`）をそのまま利用する。

→ このため §2 のメニュー（改名・追加・スカウト送信の削除）は **enger-lp で作り直す必要はなく、
dx 側の `CLIENT_NAV` が正**。**dx 側で仕上げ済み**（§6）：
   - ダッシュボード → `/`（ClientHome。充実度メーター §3 実装済み）
   - 自社案件 → `/portal/jobs`
   - おすすめ人材 → `/portal/candidates`
   - 選考管理 → `/portal/selection`
   - チャット → enger-lp の既存チャットへ**外部リンク（別タブ）**。URLは `NEXT_PUBLIC_LP_CHAT_URL`（要設定）
   - 自社情報 → `/portal/company`

**enger-lp 側の残タスク（Phase 1）**：
- チャットの実URLを運営に確認し、dx の `NEXT_PUBLIC_LP_CHAT_URL` に設定する
  （enger-lp のチャット画面が統一シェル外に残っている前提。無ければ Phase 2 の dx ネイティブ実装を検討）。
- enger-lp 独自の旧メニュー（求人・案件管理／スカウト送信／候補者・応募者＝準備中）が残っていれば撤去する。

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

- 企業ポータルの「企業プロフィール」表記を **「自社情報」に統一**（サイドメニュー・トップバー・ページ見出し・ユーザーメニュー。URL `/portal/company` は不変）。
- ClientHome（企業ポータルのホーム）に **充実度メーター（§3）** を追加。
- 統一シェルの企業メニュー（`CLIENT_NAV`）を §2 の確定構成に仕上げ：
  - 先頭を「ホーム」→ **「ダッシュボード」** に改称。
  - **「チャット」を追加**（enger-lp の既存チャットへ**外部リンク・別タブ**）。URLは `NEXT_PUBLIC_LP_CHAT_URL` で設定（既定 `https://enger.jp/business/chat` は要確認）。
  - `NavItem.external` を追加し、外部リンクは Next Link ではなく素の `<a target="_blank" rel="noopener">`（`open_in_new` アイコン付き）で描画。

## 7. 注意

- **チャットの実URL**：`NEXT_PUBLIC_LP_CHAT_URL` を運営に確認して設定すること。既定値は仮。
- enger.jp は別オリジンのため、Phase 2 のAPIは job-detail と同様に CORS 許可が必要。
- 本番反映（enger.jp 画面の変更）は **enger-lp 側の実装・デプロイが必要**（本リポジトリからは変更できない）。
