# enger.jp ↔ dx.enger.jp 連携仕様（enger.jp 側の実装ガイド）

> このリポジトリは **dx.enger.jp（社内ツール）専用**です。enger.jp 本体（会員サイト/LP）は別リポジトリのため、
> 本書は「enger.jp 側が何を実装すれば dx と連携できるか」をまとめた**仕様書**です。

## 1. 連携の基本

- enger.jp と dx.enger.jp は **同じ Supabase プロジェクト**を共有する。
- 会員・人材データは **`public.profiles`** に保存する（enger.jp が書き込み、dx が読み取り）。
- dx 独自データ（案件・提案など）は `enger` スキーマにあり、enger.jp からは触らない。

```
enger.jp(会員登録) ──write──▶ public.profiles ──read──▶ dx.enger.jp「LP登録」
```

## 2. enger.jp 側でやること

### (a) 同じ Supabase を使う
enger.jp の環境変数を dx と同一プロジェクトに向ける：
- `NEXT_PUBLIC_SUPABASE_URL`（dx と同じ）
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- 書き込みは RLS or service role の方針に従う

### (b) 会員登録時に `public.profiles` へ保存する列
| 列 | 必須 | 内容 | 例 |
|---|---|---|---|
| `id` | ✅ | Supabase Auth の user id（auth.users.id と一致） | uuid |
| `display_name` | ✅ | 表示名/氏名 | 山田 太郎 |
| `email` | ✅ | メール | you@example.com |
| `created_at` | ✅ | 登録日時（dxの「登録日時」に表示） | now() |
| `signup_source` | ◎推奨 | 流入元LPキー | `enger_lp` / `mugen_dojo` |
| `signup_method` | ◎推奨 | 登録方式 | `github`/`google`/`form`/`email` |
| `phone` | 任意 | 電話 | 090-xxxx-xxxx |
| `contact_line` | 任意 | LINE/メッセージID | line_id 等 |
| `skills` | 任意 | スキル配列 | ["React","AWS"] |
| `primary_language` | 任意 | 主要言語 | TypeScript |
| `github_login` / `github_id` | 任意 | GitHub連携時 | |
| `estimated_pay_low/mid/high` | 任意 | 想定単価(万) | 60/70/90 |
| `skill_sheet_url` | 任意 | スキルシートURL | |

> dx 側は列名の揺れも吸収します：電話＝`phone/phone_number/tel/mobile`、メッセージ＝`contact_line/line_id/line/messenger/message_app`。
> ただし**新規実装は `phone` / `contact_line` を推奨**。

### (c) `signup_source` / `signup_method` の値（重要）
dx はこの2つで「どのLP・どの方法か」をバッジ表示します。

- `signup_source`：
  - `enger_lp`（または `enger`）→「エンジャーLP」
  - `mugen_dojo`（または `dojo`）→「無限道場LP」
  - 新LPを増やすときは任意キーを入れ、dx側 `src/lib/engineers.ts` の `LP_LABEL` に1行追加
- `signup_method`：`github` / `google` / `form` / `email`

未設定でも dx はヒューリスティックで推定しますが、**明示保存を強く推奨**（正確な集計・流入分析のため）。

## 3. ログイン連携（任意・SSO）
- 同じ Supabase Auth を使えば 1アカウントで enger.jp と dx 両方にログイン可能。
- dx 側のアクセス権は `enger.app_users.role` で制御（`candidate`=人材, `client`=企業 が enger.jp 想定。`agent`/`partner`/`freelance`/`admin` が dx 側）。
- 新規は `status='pending'` → 管理者が dx の「新規登録（承認）」で承認 → 利用開始。

## 4. dx → enger.jp（人材公開など・将来）
- dx で公開可にした人材/案件を enger.jp に出す場合は、共有テーブル（public側）への書き出し or `shared` フラグ連携で対応（別途設計）。

## 5. DBマイグレーション
共有DB（同じSupabase）で次を実行：
- `supabase/enger-jp-integration.sql`（`signup_source`/`signup_method`/`phone`/`contact_line` 等）

## 6. 連携チェックリスト
- [ ] enger.jp と dx が同じ Supabase プロジェクト
- [ ] 会員登録が `public.profiles` に保存される（`id`/`display_name`/`email`/`created_at`）
- [ ] `signup_source`/`signup_method` を保存
- [ ] 連絡先 `phone`/`contact_line` を保存（取得する場合）
- [ ] `supabase/enger-jp-integration.sql` を実行
- [ ] dx の「LP登録」に新規登録者が表示されることを確認
