import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dbConfigured = Boolean(url && anonKey);

// supabase-js（内部 fetch）はデフォルトで HTTP タイムアウトを持たない。応答しないクエリが
// 1本でもあると、サーバーコンポーネントの描画が永久に完了せず、画面が「読み込み中…」の
// ままハングする（/proposals で発生）。全リクエストに AbortController で上限を設け、
// 超過時は fetch を reject させて各呼び出し側の try/catch にエラーを返す（＝無限ローディングを
// 断ち、どのクエリが詰まっているかを表面化する）。上限は SUPABASE_TIMEOUT_MS で調整可。
const REQUEST_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS ?? 20000);
const timeoutFetch: typeof fetch = (input, init) => {
  // 呼び出し側が既に signal を持つ場合はそれを尊重（こちらで上書きしない）。
  if (init?.signal) return fetch(input, init);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Supabase request timeout (${REQUEST_TIMEOUT_MS}ms)`)), REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};
const withTimeout = { global: { fetch: timeoutFetch } } as const;

/** 読み取り用 (anon, enger スキーマ固定)。サーバーコンポーネントから使用。 */
export function engerClient() {
  if (!url || !anonKey) throw new Error("Supabase env not set");
  return createClient(url, anonKey, { db: { schema: "enger" }, auth: { persistSession: false }, ...withTimeout });
}

/** 書き込み用 (service role, サーバー専用)。CSV取込などに使用。 */
export function engerAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase service role env not set");
  return createClient(url, serviceKey, { db: { schema: "enger" }, auth: { persistSession: false, autoRefreshToken: false }, ...withTimeout });
}

/** public スキーマ用 (service role, サーバー専用)。LP登録エンジニア(public.profiles)の閲覧に使用。 */
export function publicAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase service role env not set");
  return createClient(url, serviceKey, { db: { schema: "public" }, auth: { persistSession: false, autoRefreshToken: false }, ...withTimeout });
}

/** Supabase Auth 管理用 (service role, サーバー専用)。認証ユーザーの作成・パスワード変更に使用。 */
export function authAdmin() {
  if (!url || !serviceKey) throw new Error("Supabase service role env not set");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, ...withTimeout });
}
