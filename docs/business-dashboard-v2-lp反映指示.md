# enger.jp/business/dashboard に v2 を反映する — enger-lp（`morishin1/enger-lp`）向け実装指示

> **目的**：dx（`morishin1/enger-matching`）で実装した企業ダッシュボード v2（P0〜P3）を、
> 法人向けダッシュボード `https://enger.jp/business/dashboard` に反映する。
> **本ファイルは enger-lp 担当者への実装指示書**。dx 側では実装済み（マージ済み）。
> 背景・全体仕様は dx リポジトリの `docs/business-dashboard-v2-仕様.md` を参照。

---

## 0. まず確認：反映方法は「A: 自動反映」か「B: ネイティブ実装」か

`https://enger.jp/business/dashboard` が現状どちらの構成かで、やることが変わります。**最初にここを棚卸し**してください。

- **A：dx のシェルへリダイレクト／プロキシしている（シェル統一 #96 が効いている）**
  → 企業が見る画面は dx（`dx.enger.jp` の `CLIENT_NAV` と `/portal/*`）そのもの。
  **v2 は dx マージ時点で自動反映済み**。enger-lp 側の追加実装は不要。
  やること＝「`/business/dashboard` が確実に dx シェルへ着地するか」の動作確認のみ。

- **B：enger-lp がネイティブに独自実装している（dx とは別コード）**
  → 下の 2〜6 に従い、**公開API（§ 参照）を使って v2 の各機能を enger-lp 側で再現**する。
  DBやマッチングの「正」は常に dx（中央 Supabase `enger` スキーマ）。enger-lp はAPI越しに読み書きする。

> **デザイン方針**：既存の enger.jp のトンマナ・レイアウトは大きく変えない。
> 変えるのは「メニュー構成」と「各画面の機能（下記）」で、見た目は現行の枠に合わせて構いません。

---

## 1. 共通仕様（すべての公開APIに共通）

- **ベースURL**：`https://dx.enger.jp`（dx 本番）。
- **認証**：`Authorization: Bearer <Supabaseアクセストークン>`。トークンから企業アカウントを解決します。
- **CORS**：`*.enger.jp` オリジンのみ許可（`https://enger.jp` 等）。プリフライトは各APIが `OPTIONS` に対応。
- **キャッシュ**：`fetch(..., { cache: "no-store" })` 推奨（ダッシュボードは常に最新を表示）。
- **承認状態**：`active`（承認済＝フル機能）／`pending`（承認待ち＝一部のみ）／`none`（法人アカウント無し）。
  `pending` でも使えるのは「会社情報の入力」「案件の掲載申請」のみ。候補者・FB・紹介は `active` のみ（未承認は 403）。
- **エラー形**：全API `{ ok: false, error: string }`＋HTTPステータス。成功は `{ ok: true, ... }`。

---

## 2. P0：メニュー再設計 ＋ 承認ゲート

### メニュー構成（v2）— この並びに合わせる
1. ダッシュボード
2. 人材をさがす（旧「おすすめ人材」）　🔒 承認前は匿名ランキングのみ
3. 候補者・応募者（旧「選考管理」）　🔒 承認前は不可
4. 自社案件
5. AI面接（オプション）　※契約企業のみ表示（§ P3）
6. ─ 区切り ─
7. チャット（担当に相談）　※外部リンク
8. 自社情報

### 承認ゲートの出し分け
- **`GET /api/public/me`** を叩き、`status` でメニューを出し分ける。
  - レスポンス：`{ ok:true, loggedIn, status:"active"|"pending"|"none", approved, companyName, name, email, reason? }`
- 🔒 項目は**非表示にせず「ロック表示」**（クリックで「担当エージェントの承認後に利用できます。お急ぎの場合はチャットへ」を案内）。承認で機能が増える体験＝承認を待つ動機づけ。

---

## 3. P1：候補者・応募者（全媒体一括ビュー＋詳細ドロワー）

「経路（エージェント提案／応募／LINE 等）を問わず、自社案件に来た人材を1画面に集約」。

### 一覧の取得
- **`GET /api/public/proposals`**（`active` のみ。`pending` は 403）
- レスポンス：`{ ok:true, proposals: Item[] }`。`Item` は**すべて匿名**：
  ```jsonc
  {
    "id": "…",                 // proposal id（FB・後述の依頼キー）
    "job_title": "…",
    "stage": "応募|書類選考|面談|面談合格|稼働|見送り",
    "source": "line|…|null",   // 経路バッジの元。null は「エージェント提案」既定
    "created_at": "…", "stage_updated_at": "…",
    "candidate": {
      "initials": "T.Y", "title": "職種", "skills": ["React", …],
      "rate": "〜80万", "exp": "5", "remote_pref": "…",
      "avail": "…", "age_band": "30代", "nationality": "日本"
    },
    "score": 82,               // マッチ度
    "feedback": { "verdict": "want|maybe|mismatch", "reason": "…" } | null,
    "ai_interview": { "status": "…", "score": 0, "report_url": "…", "video_url": "…", "summary": "…" } | null
  }
  ```
- **一覧の1行**：イニシャル／職種／スキルタグ／希望単価／ステージ／**経路バッジ**／受信日。
- **フィルタ**：経路 / ステージ / 案件。**既定は「対応が必要な順」**（`feedback==null` を先頭→受信が新しい順）。
- **経路バッジの導出**（dx と同じ表記に合わせる）：`source==="line"`→「LINE」／LP直接応募→「応募」／それ以外→「エージェント提案」。Indeed・エン転職は将来 `source` が付き次第対応（§ P4・dx側）。

### 詳細ドロワー（右スライド・ページ遷移しない）
- 匿名プロフィール（スキル全件・経験・リモート・稼働・年代・国籍・マッチ度）
- 選考ステージのタイムライン（`stage` と日付から表示）
- **AI面接の結果**（`ai_interview` があれば表示。§ P3）
- **アクション：会いたい / 検討中 / ミスマッチ**
  - **`POST /api/public/feedback`**　body：`{ proposal_id, verdict: "want"|"maybe"|"mismatch", reason? }`
  - `mismatch` は理由入力を促す。成功で一覧のバッジを即時更新。

---

## 4. P2：エージェントに紹介（モーダル）

「人材を登録」ではなく「**エージェントに紹介**」（内容をエージェントが確認してから人材登録）。
候補者・応募者ページ／自社案件ページのヘッダーに「エージェントに紹介」ボタン→モーダル。

- **入力フォーム定義**：**`GET /api/public/form-defs`**（認証不要）→ `{ ok:true, forms:{ company, job, candidate } }`。
  `forms.candidate` の項目でフォームを描画（**dx と項目を一致させるため必ずこのAPIを使う**）。
  主な項目：`name`(任意・社内管理)・`initials`(必須)・`title`・`skills`(必須)・`rate`・`exp`・`avail`・`location`・`note` 等。
- **AI下書き**：経歴テキスト貼り付け → **`POST /api/public/ai-draft`**　body：`{ kind:"candidate", text }`
  → `{ ok:true, draft:{ initials, title, skills[], rate, exp, avail, location, note, … } }` をフォームに自動入力。
  （日次上限あり：1アカウント30回/日）
- **送信**：**`POST /api/public/candidate-referrals`**　body：candidate フォーム項目（`initials` か `name`、`skills` 必須）
  → `enger.client_referrals` に保存し、社内へ Slack 即時通知。成功：`{ ok:true, id, status:"new" }`（201）。
- **紹介履歴＋対応状況**：**`GET /api/public/candidate-referrals`**
  → `{ ok:true, referrals:[{ initials, title, skills, status, … }] }`。
  `status`：`new`(未対応) / `contacted`(対応中) / `registered`(人材登録済) / `closed`(見送り)。
- 完了メッセージ：「担当エージェントが内容を確認し、マッチする案件をおさがしします」。

---

## 5. P3：AI面接（オプション機能）

- **契約企業のみ表示**：AI面接メニュー・依頼ボタンは契約企業だけに出す。
  契約状態は現状 `GET /api/public/me` には含まれていない（dx 側は `app_users.ai_interview` で判定）。
  → **enger-lp から契約状態を知る必要があるため、下記フォローアップ（dx側）で `me` に `ai_interview` を追加する予定**。それまでは非表示でよい。
- **Phase B（結果表示）＝いま可能**：`GET /api/public/proposals` の各 `ai_interview` を候補者ドロワーに表示（スコア・要約・`report_url`・`video_url`）。
- **Phase A（AI面接を依頼）＝公開API未整備**：dx 側は内部サーバーアクションで実装済みだが、**enger-lp から叩く公開エンドポイントは未作成**。
  → 下記フォローアップ（dx側）で `POST /api/public/ai-interview-request { proposal_id }` を追加してから、依頼ボタンを実装してください。

---

## 6. （参考）会社情報・自社案件のAPI

すでに v1 から提供済み。ネイティブ実装(B)の場合はこれらも同様に：
- 自社情報：**`GET/PUT /api/public/company-profile`**（`pending` でも可）。
  GET→`{ profile:{ mission, culture, ideal_persona, appeal, website, corporate_no, industry, contact_name, phone } }`。
- 自社案件：**`GET/POST /api/public/jobs`**（`pending` でも可）。
  GET→`{ jobs:[{ job_no, title, skills, salary_min/max, remote_type, status, review_status, is_published, … }] }`。
  POST（掲載申請）→`{ ok:true, job_no, status:"審査中" }`（審査後に公開）。
- 会社情報のAI下書き：`POST /api/public/ai-draft { kind:"company", website | corporate_no }`。

---

## 7. 共有DB（中央 Supabase）— dx 側で実行済みか確認

これらは **dx と enger-lp が同じ中央 Supabase を共有**します。dx のマージ後チェックリストで実行される想定ですが、
enger-lp からAPIが 503「テーブル未整備」を返す場合は未実行です。担当に実行を依頼してください（冪等）：
- `supabase/client-referrals.sql`（紹介テーブル。P2）
- `supabase/ai-interviews.sql`（AI面接テーブル＋契約フラグ `app_users.ai_interview`。P3）

---

## 8. やらないこと（スコープ外）

- 承認・マッチング・スコアリングの独自ロジック実装（**正は dx**。APIの結果をそのまま表示するだけ）。
- 人材マスタへの直接登録（紹介は必ず `candidate-referrals` 経由＝エージェント確認後に登録）。
- 氏名・連絡先の表示（**常に匿名**＝イニシャル＋スキル＋単価。氏名/連絡先は担当が仲介）。
- サイトの大幅なデザイン刷新（現行トンマナ維持）。

---

## 9. dx 側フォローアップ（enger-lp の完全対応に必要。dx 担当が対応）

- [ ] `GET /api/public/me` に `ai_interview`（契約フラグ）を追加 … P3メニュー/ボタンの出し分け用
- [ ] `POST /api/public/ai-interview-request { proposal_id }` を新設 … P3 Phase A の依頼をlpから可能に
  （dx 内には `requestAiInterview` サーバーアクションが実装済み。これを公開APIとして薄くラップする）

---

## 10. 完了チェックリスト（enger-lp 担当）

- [ ] `/business/dashboard` の反映方法（A/B）を確定
- [ ]（Bの場合）メニューを v2 構成へ＋`me` による承認ゲートのロック表示（P0）
- [ ]（Bの場合）候補者・応募者の全媒体一括ビュー＋ドロワー＋FB（P1）
- [ ]（Bの場合）エージェントに紹介モーダル（form-defs / ai-draft / candidate-referrals）（P2）
- [ ] AI面接の結果表示（proposals.ai_interview）（P3 Phase B）
- [ ] （dxフォローアップ後）AI面接の契約出し分け＋依頼ボタン（P3 Phase A）
- [ ] 中央Supabaseのマイグレーション実行確認（§7）

> 別途、統一前の旧シェル撤去・チャット実URL提供の依頼は `docs/business-dashboard-v2-lp側依頼.md` を参照。
