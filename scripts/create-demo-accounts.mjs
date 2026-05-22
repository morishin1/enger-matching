// デモアカウント作成スクリプト（ローカル実行専用）
//   使い方:  node scripts/create-demo-accounts.mjs
//   .env.local から Supabase URL / service role key を読み取り、
//   3ロール(管理者/営業/ユーザー企業)の認証ユーザー + app_users(承認済み) を作成します。
//   ※ service role を使うためサーバ環境でのみ実行してください。

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---- .env.local を読み込む ----
function loadEnv() {
  let txt = "";
  try { txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch {}
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = loadEnv();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) { console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が見つかりません (.env.local を確認)"); process.exit(1); }

const auth = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const enger = createClient(URL_, SERVICE, { db: { schema: "enger" }, auth: { persistSession: false } });

// ---- デモ用の会社名: 公開案件で最も多い client_name を自動採用（自社案件が表示されるように） ----
async function pickDemoCompany() {
  try {
    const { data } = await enger.from("jobs").select("client_name").eq("is_published", true).not("client_name", "is", null).limit(1000);
    const counts = {};
    for (const r of data ?? []) { const c = (r.client_name || "").trim(); if (c) counts[c] = (counts[c] ?? 0) + 1; }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top?.[0] ?? null;
  } catch { return null; }
}

// ---- 認証ユーザーを作成 or 既存ならパスワード更新 ----
async function ensureAuthUser(email, password, fullName) {
  // 既存検索（ページング省略・デモ用途）
  const { data: list } = await auth.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = list?.users?.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
  if (found) {
    await auth.auth.admin.updateUserById(found.id, { password, email_confirm: true, user_metadata: { full_name: fullName } });
    return { id: found.id, created: false };
  }
  const { data, error } = await auth.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw error;
  return { id: data.user.id, created: true };
}

async function upsertAppUser(row) {
  const { error } = await enger.from("app_users").upsert({ ...row, status: "active", approved_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) throw error;
}

async function main() {
  const company = await pickDemoCompany();
  // 営業デモの名前は既存 staff 名に合わせると「自分の担当」が表示される
  let agentName = "デモ営業";
  try {
    const { data } = await enger.from("staff").select("name").eq("is_proposer", true).eq("active", true).limit(1);
    if (data?.[0]?.name) agentName = data[0].name;
  } catch {}

  const accounts = [
    { email: "demo-admin@enger.jp",   password: "EngerDemo#Admin1",   name: "デモ管理者",     role: "admin",  company_name: null },
    { email: "demo-agent@enger.jp",   password: "EngerDemo#Agent1",   name: agentName,        role: "agent",  company_name: null },
    { email: "demo-company@enger.jp", password: "EngerDemo#Client1",  name: "デモ企業 担当者", role: "client", company_name: company },
  ];

  console.log("Supabase:", URL_);
  console.log("デモ企業の会社名(自動選定):", company ?? "(該当なし — 後で設定画面で会社名を入力してください)");
  console.log("");

  for (const a of accounts) {
    try {
      const u = await ensureAuthUser(a.email, a.password, a.name);
      await upsertAppUser({ email: a.email, name: a.name, role: a.role, company_name: a.company_name });
      console.log(`✓ ${a.role.padEnd(6)} ${a.email}  / pass: ${a.password}  ${u.created ? "(新規作成)" : "(更新)"}`);
    } catch (e) {
      console.error(`✗ ${a.email}:`, e.message || e);
    }
  }

  console.log("\n完了。https://dx.enger.jp/login でログインして各ロールの表示を確認できます。");
  console.log("不要になったら設定→アカウント管理で削除、または Supabase の Authentication からユーザー削除してください。");
}

main();
