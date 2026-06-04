# LP登録の連動仕様（enger.jp / mugendojo.jp など）

各 LP が **共通の Supabase `public.profiles`** にエンジニア情報を保存することで、
enger 本体（dx.enger.jp）の「LP登録」タブに自動表示されます。
登録元の正確な判別のため、各 LP は以下の 2 列に **登録時に値を保存** してください。

## 1. 追加列（DB 側で 1 回だけ実行）

```sql
-- supabase/profiles-signup-source.sql 同等
alter table public.profiles
  add column if not exists signup_source text,   -- 'enger' | 'dojo' | 将来の値
  add column if not exists signup_method text;   -- 'github' | 'google' | 'form' | 'email'

create index if not exists profiles_signup_source_idx on public.profiles (signup_source);
```

## 2. LP 側の実装

各 LP は **profile を作るとき** に必ずこの 2 列に値を入れてください。

### enger.jp の例

```ts
// GitHub ログイン経由
await supabase.from("profiles").insert({
  id: user.id,
  github_login: user.user_metadata.user_name,
  display_name: user.user_metadata.full_name,
  email: user.email,
  signup_source: "enger",
  signup_method: "github",
});

// Google ログイン経由
await supabase.from("profiles").insert({
  id: user.id,
  display_name: user.user_metadata.name,
  email: user.email,
  signup_source: "enger",
  signup_method: "google",
});

// フォーム/メール登録
await supabase.from("profiles").insert({
  id: user.id,
  display_name: form.name,
  email: form.email,
  signup_source: "enger",
  signup_method: "form",
});
```

### mugendojo.jp の例

```ts
// GitHub ログイン経由
await supabase.from("profiles").insert({
  id: user.id,
  name: user.user_metadata.user_name,
  role: "student",
  github_login: user.user_metadata.user_name,
  signup_source: "dojo",
  signup_method: "github",
});

// Google ログイン経由
await supabase.from("profiles").insert({
  id: user.id,
  name: user.user_metadata.name,
  email: user.email,
  role: "student",
  signup_source: "dojo",
  signup_method: "google",
});

// フォーム登録
await supabase.from("profiles").insert({
  id: user.id,
  name: form.username,
  email: form.email,
  role: "student",
  signup_source: "dojo",
  signup_method: "form",
});
```

## 3. 既存データのバックフィル（enger 側で 1 回実行）

`supabase/profiles-signup-source-backfill.sql` を実行すると、既存の `role='student'` / `github_login` / `display_name` 等の手がかりから `signup_source` / `signup_method` を埋めます。冪等なので何度実行しても安全。

## 4. enger 本体の表示

`src/lib/engineers.ts` の `classifySource()` が以下の優先で判定します：

1. `profiles.signup_source` / `profiles.signup_method` 列の値（最優先）
2. 既存のヒューリスティック（`role=student` / `github_login` / `display_name`）

バッジは「**LP名 · 登録方式**」形式で表示（例：`エンジャーLP · GitHub` / `無限道場LP · Google`）。

## 5. 新しい LP / 登録方式を追加するには

1. LP 側で新しい `signup_source` または `signup_method` 値を入れる
2. `src/lib/engineers.ts` の `LP_LABEL` / `METHOD_LABEL` に表示名を **1 行追加**

例：LinkedIn 登録を追加
```ts
const METHOD_LABEL: Record<string, string> = {
  github: "GitHub",
  google: "Google",
  form:   "フォーム",
  email:  "メール",
  linkedin: "LinkedIn",  // ← 追加
};
```
