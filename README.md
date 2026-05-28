# ENGER matching

エンジニア人材／案件のマッチング・提案・稼働管理を扱う社内アプリ（Next.js 16 / React 19 / Supabase）。

## 開発セットアップ

### 1) クローン & 依存導入
```bash
git clone <repo>
cd enger-matching
npm ci
```

### 2) 環境変数
`.env.example` を `.env.local` にコピーして値を埋める：
```bash
cp .env.example .env.local
```
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` は **必須**（Supabase コンソール → Project Settings → API）
- 実値は **コミットしない**。共有は Vercel 環境変数 or 1Password 等の安全な経路で。

### 3) DB スキーマ
`supabase/` 配下の SQL を Supabase の SQL Editor で順次実行（最初は `schema-matching.sql`、その後機能ごとの拡張 SQL）：
- `schema-matching.sql` … jobs / candidates / proposals の基本
- `email-columns.sql` … 元メールURL／送信元メール列の追加
- `proposals-ops.sql` … 提案管理の拡張列
- 他、必要に応じて

### 4) 起動
```bash
npm run dev
```
http://localhost:3000

## スクリプト
- `npm run dev` — 開発サーバ
- `npm run build` — 本番ビルド
- `npm start` — 本番サーバ
- `npx tsc --noEmit` — 型チェック（CI でも実行）

## 共同開発のルール

複数人（Claude Code を含む）で並行開発します。**短命ブランチ + PR + レビュー**を徹底します。

### ブランチ
- `main` … 常にデプロイ可能。直接 push 禁止。
- 人間開発者 … `feat/<name>/<topic>`（例：`feat/sato/proposal-form`）
- Claude Code … `claude/<topic>`（例：`claude/web-dev`）

### 流れ
1. **最新化**：作業開始前に `git fetch origin && git rebase origin/main` で main を取り込む
2. **小さく切る**：1 PR は 1 トピックに絞る。長持ちさせない（理想は1〜2日でマージ）
3. **PR**：GitHub UI または `gh pr create` で main へ PR を作成
   - タイトルは目的を1文で（例：`提案管理に新規追加ボタンを設置`）
   - 本文に「概要 / 変更点 / 確認」を書く
4. **CI**：PR で `typecheck + build` が自動で走る（`.github/workflows/ci.yml`）。red の PR はマージ禁止
5. **レビュー**：別のメンバーが内容を確認 → 必要なら修正コミット → Approve → マージ
6. **同期**：merge 後は他の人も `git pull --rebase origin main` で取り込む

### コンフリクトを避けるコツ
- 同じファイルを長時間同時編集しない（事前に Slack / Issue で宣言）
- コンポーネントや機能単位で担当を切る
- 大きなリファクタはまず Issue で合意してから

### 役割分担の目安
- **Claude Code**：UI 改修、定型機能追加、リファクタ、ドキュメント
- **人間開発者**：複雑な仕様判断、外部統合、セキュリティ、データ移行
- 重複作業を防ぐため、着手前に PR / Issue / Slack で「いまこれやります」を共有

## デプロイ
Vercel に自動デプロイ（`main` 更新で本番、PR ごとにプレビュー）。
- 環境変数は Vercel Project Settings → Environment Variables で管理
- デプロイ状況：Vercel Dashboard → Deployments

## 注意事項
- **`.env*` はコミット禁止**（`.gitignore` 済）
- `node_modules/next/dist/docs/` に Next.js 16 のローカルドキュメントあり。挙動が分からないときは training data に頼らず先にここを参照
- Material Icons をデフォルトに使う（詳細は `CLAUDE.md` の UI 規約）

## Claude Code 拡張（Superpowers）

このプロジェクトの開発では Claude Code の **Superpowers** プラグインを使用します（`/autopilot`、`/bugfix`、`/dashboard`、`/docs`、`/investigate`、`/deep-research` などのスキルを提供）。

### インストール（各開発者が1回だけ実施）
ローカルの Claude Code で以下を実行：
```
/plugin install superpowers@claude-plugins-official
```
インストール後、Claude Code を再起動してください。次セッション開始時にスキルシステムが自動でロードされます。

- 公式マーケットプレイス：[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- Superpowers 本体／ドキュメント：[obra/superpowers](https://github.com/obra/superpowers) ／ [obra/superpowers-marketplace](https://github.com/obra/superpowers-marketplace)

### 主なスキルと使い所
- `/autopilot` — 自己完結型タスクをエンドツーエンドで実装→レビュー→PR 作成まで
- `/bugfix` — 再現テスト→根本原因→最小修正→回帰テスト→PR
- `/investigate` — 障害・不可解な挙動の根本原因を仮説競合方式で特定
- `/docs` — 仕様書・ドキュメント生成
- `/code-review` / `/simplify` — 差分のレビュー・自動修正
- `/verify` — 変更が実際に動くか起動して確認

## 関連ドキュメント
- Supabase SQL: `supabase/`
- 開発エージェント規約: `AGENTS.md` / `CLAUDE.md`
