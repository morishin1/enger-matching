import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dbConfigured = Boolean(url && anonKey);

/** 読み取り用 (anon, enger スキーマ固定)。サーバーコンポーネントから使用。 */
export function engerClient() {
  if (!url || !anonKey) throw new Error("Supabase env not set");
  return createClient(url, anonKey, { db: { schema: "enger" }, auth: { persistSession: false } });
}

/** 書き込み用 (service role, サーバー専用)。CSV取込などに使用。 */
export function engerAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase service role env not set");
  return createClient(url, serviceKey, { db: { schema: "enger" }, auth: { persistSession: false, autoRefreshToken: false } });
}

/** public スキーマ用 (service role, サーバー専用)。LP登録エンジニア(public.profiles)の閲覧に使用。 */
export function publicAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase service role env not set");
  return createClient(url, serviceKey, { db: { schema: "public" }, auth: { persistSession: false, autoRefreshToken: false } });
}

/** Supabase Auth 管理用 (service role, サーバー専用)。認証ユーザーの作成・パスワード変更に使用。 */
export function authAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase service role env not set");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
