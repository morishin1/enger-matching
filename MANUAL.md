# ENGER 運営・管理者マニュアル

> 対象: 運営・管理者（社内スタッフ）
> 最終更新: 2026-05-25
> このドキュメントは ENGER エコシステム全体（LP / dx / LMS）の構成・運用手順をまとめたものです。

---

## 1. 全体構成

ENGER は **1つの中央 Supabase** を共有する3つのシステムで構成されます。

| システム | URL | 役割 | リポジトリ | 技術 | ホスティング |
|---|---|---|---|---|---|
| **LP** | `enger.jp` | エンジニア向けの登録・案件探し・スカウト受信 | `morishin1/enger-lp` | Astro 5 (SSR) | Vercel |
| **dx** | `dx.enger.jp` | 社内の営業/管理ツール（人材・案件・選考管理） | `morishin1/enger-matching` | Next.js 16 (App Router) | Vercel |
| **LMS** | （別ドメイン） | 教育・学習管理プラットフォーム | `morishin1/lms` 他 | — | Cloudflare |

### 中央 Supabase

- プロジェクト ref: `htglvascsuqkixpmclwr`
- スキーマは3つに分離:
  - **public** … エンジニアのプロフィール（`profiles`）。LP が書き込み、dx が読み取り。
  - **enger** … 業務データ（`jobs` 案件 / `candidates` 人材 / `proposals` 提案 / `scouts` スカウト / `applications` 応募 / `companies` 企業 など）
  - **lms** … 学習管理データ

> 重要: 3システムは同じDBを見ているため、LP でエンジニアが登録すると dx の「エンジャー登録」一覧に反映され、dx で送ったスカウトは LP の受信箱に届く、という双方向連携が成立しています。

---

## 2. アカウントと権限（RBAC）

dx のアクセス権は `enger.app_users` の **role** で決まります。

| role | 誰 | 見える画面 |
|---|---|---|
| **admin** | 経営・管理者 | 全機能 ＋ 経営ダッシュボード（KGI/KPI）、日報の管理（カレンダー）、選考全体 |
| **agent** | 営業エージェント・一般職 | 営業職能あり→人材/案件/提案/選考。営業職能なし（バックオフィス等）→業務ホーム |
| **client** | 求人企業 | 企業ポータルのみ（緑テーマ）。自社案件・おすすめ人材・選考・企業プロフィール |

- 役割判定は `currentAccess()` / `resolveAccess()`、メニューは `Sidebar.tsx` の `CLIENT_NAV` 等で制御。
- client ロール時は `.app` に `theme-client` クラスが付き、ブランドカラーが緑に切り替わります。

### ログイン方法

- **LP（エンジニア）**: GitHub / Google / メール（マジックリンク）の3方式。新規登録時は利用規約・プライバシーへの同意が必須。
- **dx（社内・企業）**: ログイン画面から。Google ログインは同意チェック後に有効化。

---

## 3. dx 管理画面（dx.enger.jp）メニュー別ガイド

| ルート | 画面名 | 用途 |
|---|---|---|
| `/` | ホーム/ダッシュボード | role 別に出し分け。admin は経営ダッシュボード（成長ファネル・登録KPI・エージェント別実績）＋企業からの人材リクエスト |
| `/engineers` | エンジャー登録 | LP 登録エンジニア一覧。対応履歴、スカウト送信、応募案件のステージ管理、ポートフォリオ/スキルシート閲覧 |
| `/people`, `/people/[no]` | 人材 | candidates（CSV由来の人材）一覧・詳細 |
| `/jobs` | 案件 | enger.jobs 一覧（決まりやすい順スコア） |
| `/matching` | マッチング | 案件×人材のマッチング |
| `/proposals` | 提案 | 提案・進捗（ステージ管理） |
| `/pipeline` | パイプライン | 営業パイプライン |
| `/meetings` | 面談 | 面談管理・フォローアップ |
| `/progress` | 稼働 | engagements（成約後の稼働管理） |
| `/companies` | 企業 | 企業マスタ |
| `/reports` | 日報 | **admin**: 提出カレンダー（誰がいつ提出したか）＋レビュー。**一般職**: 日報フォーム |
| `/inbox` | 受信箱 | LP のお問い合わせフォーム（enger.contact_messages）が届く。ステータス管理 |
| `/notifications` | 通知 | 役割別フィルタ通知 |
| `/analytics` | 分析 | 各種統計 |
| `/billing` | 請求 | 請求管理 |
| `/ai` | AI | AI 機能 |
| `/search` | 検索 | 横断検索 |
| `/settings` | 設定 | アカウント設定 |
| **企業ポータル** | | |
| `/portal/jobs` | 自社案件 | 企業が案件を掲載（管理者承認制） |
| `/portal/candidates` | おすすめ人材 | 匿名化されたマッチ人材（イニシャル・スキル・単価のみ。氏名/連絡先は非開示） |
| `/portal/selection` | 選考管理 | 企業側の選考状況 |
| `/portal/company` | 企業プロフィール | Mission等。**ホームページURLを貼るとAIが自動記入** |

### admin 経営ダッシュボード（`/` の AdminGrowthBoard）

「エンジニアが増える → 企業がスカウトする → 売上が上がる」の仕組み化を可視化:
- **成長ファネル**: 登録エンジニア → スカウト → 応募 → 面談合格 → 稼働（各転換率%）
- **登録KPI**: エンジニア総数 / 直近30日 / GitHub連携数、企業総数 / 直近30日、公開案件数、進行中応募
- **エージェント別実績**: 提案・スカウト・面談・成約の担当者別集計

---

## 4. LP（enger.jp）エンジニア向け機能

| ルート | 画面 | 機能 |
|---|---|---|
| `/` | トップ | サービス紹介 |
| `/signup` | 新規登録 | 同意フロー（利用規約・プライバシー同意）。`?ref=` で紹介コードをcookie保持 |
| `/dashboard` | ダッシュボード | 市場価値（スキル3件以上で推定単価表示）、おすすめ案件、スカウト通知、紹介招待カード、応募状況、Xシェア＋動的OGP |
| `/profile` | プロフィール編集 | スキルタグ、希望単価、ポートフォリオURL、スキルシートUP、**Qiita連携でスキル自動追加** |
| `/jobs` | 案件を探す | おすすめ順で上位20件をデフォルト表示、企業名は非表示（応募後開示）、検索/絞り込み/お気に入り/応募/詳細モーダル |
| `/scout` | スカウト受信箱 | 営業からのスカウトを確認・返信 |
| `/card` | 市場価値シェアカード | SNSシェア用（og:image 動的生成） |
| `/skills/[slug]`, `/skills` | スキル別SEOページ | 集客用 |
| `/business`, `/company`, `/contact` | 企業案内・会社情報・お問い合わせ | |
| `/terms`, `/terms-engineer`, `/privacy`, `/tokushoho` | 規約・プライバシー・特商法 | 法務ページ |

### スキル解析の仕組み
- **GitHub**: 連携ユーザーの言語/リポジトリ/スター実績から推定（`analyzeGithubUser`）。
- **Qiita**: ユーザー名から公開API（`qiita.com/api/v2/users/{id}/items`）で記事タグを集計しスキル化（`analyzeQiitaUser`）。GitHubと併用。
- **推定単価**（`estimatePay`）: スキル3件以上のみ表示。薄いプロフィールに架空の高単価を出さないようFLOOR=45万でガード。

---

## 5. 連携フロー（двусторонняя マッチング）

```
エンジニア(LP)              中央Supabase               営業/企業(dx)
─────────────              ───────────                ──────────────
登録/プロフィール充実  →   public.profiles      →   /engineers でエンジニア閲覧
案件を探す/応募        →   enger.applications   →   /portal/selection・応募ステージ管理
スカウト受信/返信      ←   enger.scouts         ←   /engineers でスカウト送信
                                                     企業が /portal/jobs で案件掲載
案件マッチ(LP /jobs)   ←   enger.jobs           ←   管理者が承認
おすすめ人材(匿名)     →   candidates+profiles  →   /portal/candidates（企業に匿名表示）
```

### 応募ステージ追跡
`enger.applications` の **stage** で `profiles.id`（engineer_id）単位に追跡:
`応募 → 書類選考 → 面談 → 面談合格 → 稼働 / 見送り`
- LP `/dashboard` でエンジニアに応募状況を表示。
- 紹介経由の成約（稼働）数は `referred_by × applications.stage='稼働'` でカウント。

---

## 6. 運用作業手順

### 6-1. SQL（DBマイグレーション）の適用
1. Supabase ダッシュボード → 対象プロジェクト（`htglvascsuqkixpmclwr`） → **SQL Editor**
2. 該当の `.sql` ファイル内容を貼り付けて Run
3. すべて**冪等**（何度実行しても安全）。`Success. No rows returned` が正常
4. enger スキーマを新規参照する場合は Settings → API → **Exposed schemas** に `enger` があることを確認（設定済み）

### 6-2. デプロイ（git push）
- **LP**: ローカルブランチが `favicon-ogp` のため
  ```bash
  cd "D:\Claude\システム\LMS_ITS\LMSv1\enger-lp"
  git push origin HEAD:main
  ```
- **dx**:
  ```bash
  cd "D:\Claude\システム\LMS_ITS\LMSv1\v2\enger-matching"
  git push origin main
  ```
- push すると Vercel が自動デプロイ。**Vercel の「Redeploy」は使わない**（古いコミットを再ビルドするため）。新しい変更は必ず git push で反映する。

### 6-3. 環境変数（Vercel / .env.local）
- `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`（LP）/ `NEXT_PUBLIC_*`（dx）
- `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用・絶対に公開しない）
- ※APIキーは決してコミット・貼り付けしない。Google client secret は再生成しない。

---

## 7. SQL ファイル一覧

### dx（`enger-matching/supabase/`）
| ファイル | 内容 |
|---|---|
| `schema-matching.sql` | enger コア（companies/candidates/proposals/engagements） |
| `accounts.sql`, `account-functions.sql`, `sales-roles.sql` | アカウント・職能・営業ロール |
| `staff.sql`, `daily-reports.sql` | スタッフ・日報 |
| `scouts.sql` | スカウト |
| `applications-favorites.sql`, `applications-stage.sql` | 応募・お気に入り・ステージ |
| `client-jobs.sql`, `company-profiles.sql`, `talent-interest.sql` | 企業案件・企業プロフィール・人材興味 |
| `contact-messages.sql` | お問い合わせ受信箱 |
| `engineer-actions.sql` | 対応履歴 |
| `meetings.sql`, `meetings-followup.sql`, `engagement-ops.sql`, `proposals-ops.sql` | 面談・稼働・提案運用 |
| `stats-rpc.sql`, `companies-rpc.sql`, `quality.sql`, `notifications.sql` | 統計RPC・通知・品質 |
| `ai-usage.sql`, `billing.sql`, `focus-flag.sql`, `email-columns.sql` ほか | 補助列・機能フラグ |

### LP（`enger-lp/supabase/`）
| ファイル | 内容 |
|---|---|
| `schema.sql` | 基本（profiles 等） |
| `profiles-manual.sql` | headline 追加 |
| `profiles-portfolio.sql` | portfolio_url / skill_sheet_url ＋ storage バケット `skillsheets`（public） |
| `referrals.sql` | referral_code / referred_by（紹介機能） |
| `profiles-qiita.sql` | qiita_id 追加 |

---

## 8. 成長・PR 施策

- **市場価値シェアカード**（LP `/card`, `/dashboard`）: 推定単価を画像化し X でシェア → エンジニア集客。
- **動的OGP**（`/og/card.png.ts`）: @vercel/og で数値を焼き込んだ画像を生成（日本語回避のため円は `¥620,000` 形式）。
- **紹介機能**: 招待リンク（`?ref=`）＋ 報酬ティア。**有効な紹介のみカウント**（github_id か skills 3件以上の本人確認できる登録）。売上連動で稼働数も計上。
- **SEO**: スキル別ページ（`/skills/*`）＋ 動的 `sitemap.xml`。

---

## 9. 法務・コンプライアンス

- **保有許認可**: 有料職業紹介事業 `13-ユ-306955号` / 労働者派遣事業 `般13-305865号`。SES（準委任）対応。
- **会社情報**: 設立 2004年11月1日 / 資本金 3,000万円。
- **法務ページ**: 利用規約（企業向け16条）/ エンジニア向け規約 / プライバシーポリシー（第三者提供・外国提供条項あり）/ 特商法。
- **個人情報保護**: 登録時に「求人企業への情報共有」の同意フローを実装。
- **企業への人材表示は必ず匿名化**（イニシャル・スキル・単価のみ。氏名/連絡先は非開示）— 職業安定法・同意の観点。

> ⚠️ 法的判断は専門家確認が必要です。招待報酬の職安法上の扱い、手数料規制等は弁護士レビューを推奨します（本マニュアルは法的助言ではありません）。

---

## 10. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| LP の変更が反映されない | push 漏れ | `git push origin HEAD:main` を実行 |
| Vercel が古いコミットをデプロイ | Redeploy ボタン使用 | git push で新コミットを送る（空コミットで再トリガ可） |
| 「This page couldn't load」（企業の案件掲載等） | `"use server"` ファイルから const を export | 非関数 const はクライアント側でローカル定義する |
| Google ログイン画面に `htglvascsuqkixpmclwr.supabase.co` 表示 | 認証エンドポイントが Supabase ドメイン | 実害なし。気になる場合は Supabase Custom Domain（月$10）で `auth.enger.jp` 化 |
| 市場価値が薄いプロフィールで高額表示 | 推定ロジック | skills 3件以上にゲート済み（FLOOR 45万） |
| 案件詳細に業務内容が出ない | `detail`/`work_location` 列が空 | CSV取り込み時にこれらの列を埋める |
| メールログインできない | プロフィール未充実 | Google/メール/GitHub いずれでもログイン可。プロフィール編集で充実 |

---

## 11. セキュリティ・運用上の鉄則

1. **APIキー・サービスロールキーは絶対にコミット/貼り付けしない。**
2. **main への push は運営本人が実施**（LP: `git push origin HEAD:main` / dx: `git push origin main`）。
3. **企業に見せる人材情報は必ず匿名化。**
4. **SQL 適用後は必ず動作確認**（Success メッセージ確認 → 画面で反映確認）。
5. ユーザーの個人情報を不必要に列挙・出力しない。
