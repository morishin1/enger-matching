# LINE WORKS × ENGER 連携セットアップ（Phase 0 / Phase 1）

LINE WORKS のトークに人材・案件情報を送ると、ENGER が自動で構造化・登録し、
スキル一致でマッチングした上位候補をトークに返信します。

```
[LINE WORKS トーク]──Webhook──▶[/api/lineworks/webhook]──AI抽出──▶[ENGERに登録(signup_source=line_works)]
                                                            └──スキル一致マッチング──▶[トークへ上位候補を返信]
```

## Phase 0：契約と準備（運用者の作業）

1. **LINE WORKS を契約**（Bot/API を使うため Standard 以上を推奨）。
   - 管理者画面：https://admin.worksmobile.com
   - Developer Console：https://developers.worksmobile.com
2. **API 2.0 アプリを作成**（Developer Console → 「アプリ」）。次を控える：
   - `Client ID` / `Client Secret`
   - `Service Account`（例：`xxxx.serviceaccount@your-domain`）
   - `Service Account の秘密鍵`（PEM。ダウンロードした private key）
3. **Bot を作成**（Developer Console → 「Bot」）。次を控える：
   - `Bot ID`（数値）
   - `Bot Secret`（Webhook 署名検証用）
   - **Callback URL（Webhook）** に次を設定：
     `https://dx.enger.jp/api/lineworks/webhook`
   - Bot を有効化し、利用するトークルーム（グループ）に Bot を招待。
4. **Bot の権限/スコープ**：メッセージ送受信（`bot`, `bot.message`）を許可。

## ENGER 側の環境変数（Vercel など）

| 変数 | 内容 |
|---|---|
| `LINEWORKS_CLIENT_ID` | API 2.0 アプリの Client ID |
| `LINEWORKS_CLIENT_SECRET` | 同 Client Secret |
| `LINEWORKS_SERVICE_ACCOUNT` | Service Account（`...serviceaccount@domain`） |
| `LINEWORKS_PRIVATE_KEY` | Service Account の秘密鍵(PEM)。改行は `\n` でエスケープして1行で設定可 |
| `LINEWORKS_BOT_ID` | Bot ID（数値） |
| `LINEWORKS_BOT_SECRET` | Webhook 署名検証用の Bot Secret |
| `NEXT_PUBLIC_SITE_URL` | （任意）返信リンクのベースURL。未設定時は `https://dx.enger.jp` |

> これらが未設定の場合、Webhook は何もせず 200 を返します（安全に no-op）。

### 疎通確認
- `GET https://dx.enger.jp/api/lineworks/webhook` → `{"ok":true,"configured":true}` を確認。

## Phase 1：使い方（営業の運用）

Bot が入っているトークに、人材または案件の情報を投稿します。

- **先頭に種別を付ける**と確実です：
  - 人材：`人材 田中太郎 Java/AWS 70万 即日 フルリモート希望 …`
  - 案件：`案件 ECサイト改修 React/TypeScript 80万 一部リモート 都内 …`
- 先頭の種別が無い場合は AI が自動判定します（曖昧なときは種別を付けて再送するよう返信します）。

投稿すると Bot が：
1. 内容を構造化して ENGER に登録（`signup_source = line_works`。人材一覧/案件一覧の「登録元」で絞り込み可）。
2. スキル一致で上位3件をマッチングし、**カルーセル**でトークに返信（各カードから ENGER の該当画面へ）。

## 既知の制限（Phase 1 時点）
- 返信は**閲覧（ENGERを開く）リンクのみ**。トーク内での「提案/承認」ボタン操作は Phase 2 で対応予定。
- メッセージ JSON・エンドポイントは LINE WORKS の最新仕様に合わせて `src/lib/lineworks.ts` を調整してください。
- スキルが抽出できない投稿はマッチング0件になります（抽出プロンプトはスキル重視に強化済み）。
