import { cache } from "react";
import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { authServerClient, authConfigured } from "./supabase-auth";
import { type Role, type AccountStatus, canAccess, roleHome } from "./roles";

/** 1リクエスト内でログインユーザーのメールを1回だけ解決（layout と各ページの二重 getUser を防ぐ）。 */
export const getSessionEmail = cache(async (): Promise<string> => {
  if (!authConfigured) return "";
  try {
    const sb = await authServerClient();
    const { data: { user } } = await sb.auth.getUser();
    return user?.email?.toLowerCase() ?? "";
  } catch { return ""; }
});

export { canAccess, roleHome };
export type { Role, AccountStatus };
export type SalesPosition = "inside" | "outside" | null;
export type Account = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccountStatus;
  company_name: string | null;
  position: SalesPosition;
  functions: string[] | null;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by_email?: string | null;
  approved_by_name?: string | null;
  meeting_done?: boolean | null;
  meeting_done_at?: string | null;
  meeting_done_by_email?: string | null;
  meeting_done_by_name?: string | null;
};

/** メールでアカウントを取得（サーバ専用 / service role）。 */
export async function getAccountByEmail(email: string): Promise<Account | null> {
  const e = (email || "").toLowerCase().trim();
  if (!e || !dbConfigured) return null;
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("*").ilike("email", e).maybeSingle();
    if (error || !data) return null;
    return data as Account;
  } catch { return null; }
}

/**
 * ログイン中ユーザーのアクセス情報を解決。
 *  1) app_users にレコードあり → その role/status
 *  2) 無い場合は staff の email 許可リストにあれば admin 扱い（移行期の締め出し防止）
 *  3) どちらも無ければ null（未許可）
 */
export const resolveAccess = cache(async (email: string): Promise<{ role: Role; status: AccountStatus; companyName: string | null; name: string | null; position: SalesPosition; functions: string[]; meetingDone: boolean } | null> => {
  const acc = await getAccountByEmail(email);
  if (acc) return { role: acc.role, status: acc.status, companyName: acc.company_name, name: acc.name, position: (acc.position ?? null) as SalesPosition, functions: (acc.functions ?? []) as string[], meetingDone: !!(acc as any).meeting_done };

  // フォールバック: 既存 staff 許可リストに載っている email のみ admin（移行期の救済）。
  // ※ 未登録の email を admin に“素通り”させない（Googleログイン等で勝手に管理者になる事故を防止）。
  //    app_users に未登録の人は null（=未許可）。コールバックで承認待ち(client)として作成される。
  const e = (email || "").toLowerCase().trim();
  if (!e || !dbConfigured) return null;
  try {
    const sb = engerClient();
    const { data, error } = await sb.from("staff").select("name, email, position").eq("active", true).not("email", "is", null);
    if (error) return null;
    const rows = (data ?? []) as { name: string; email: string | null; position?: string | null }[];
    if (rows.length === 0) return null;
    const me = rows.find((r) => String(r.email || "").toLowerCase() === e);
    if (me) return { role: "admin", status: "active", companyName: null, name: me.name ?? null, position: (me.position ?? null) as SalesPosition, functions: [], meetingDone: true };
    return null;
  } catch { return null; }
});

/** 承認待ちアカウントを作成（自己登録 / Google初回）。既存はそのまま。 */
export async function createPendingAccount(opts: { email: string; name?: string | null; role?: "agent" | "client" | "candidate" | "partner" | "freelance"; companyName?: string | null }): Promise<{ ok: boolean; created: boolean; error?: string }> {
  const e = (opts.email || "").toLowerCase().trim();
  if (!e) return { ok: false, created: false, error: "メールアドレスが不正です" };
  if (!dbConfigured) return { ok: false, created: false, error: "DB未設定" };
  try {
    const existing = await getAccountByEmail(e);
    if (existing) return { ok: true, created: false };
    const sb = engerAdmin();
    const { error } = await sb.from("app_users").insert({
      email: e,
      name: opts.name ?? null,
      role: opts.role ?? "client",
      status: "pending",
      company_name: opts.companyName ?? null,
    });
    if (error) return { ok: false, created: false, error: error.message };
    // 管理者へアプリ内通知（#15：登録申請時に通知が来ない問題への対応）。best-effort。
    try {
      const who = opts.companyName ? `${opts.companyName}（${e}）` : (opts.name ? `${opts.name}（${e}）` : e);
      await sb.from("notifications").insert({
        recipient: "all",
        title: "新規アカウント登録申請",
        body: `${who} が登録申請しました。設定 → アカウント・権限管理で承認してください。`,
        kind: "info",
      });
    } catch { /* notifications 未整備でも登録は成功 */ }
    return { ok: true, created: true };
  } catch (err: any) { return { ok: false, created: false, error: String(err?.message ?? err) }; }
}

/** ログイン中ユーザーのアクセス情報（role/status/会社名/名前）。未ログインや未設定は null。 */
export async function currentAccess(): Promise<{ role: Role; status: AccountStatus; companyName: string | null; name: string | null; position: SalesPosition; functions: string[]; meetingDone: boolean; email: string } | null> {
  if (!authConfigured) return { role: "admin", status: "active", companyName: null, name: null, position: null, functions: [], meetingDone: true, email: "" };
  try {
    const email = await getSessionEmail(); // cache() でリクエスト内1回に集約
    if (!email) return null;
    const access = await resolveAccess(email);
    if (!access) return null;
    return { ...access, email };
  } catch { return null; }
}

/** 承認待ち一覧（管理者用）。 */
export async function listAccounts(): Promise<Account[]> {
  if (!dbConfigured) return [];
  try {
    const sb = engerAdmin();
    const { data, error } = await sb.from("app_users").select("*").order("created_at", { ascending: false });
    if (error || !data) return [];
    return data as Account[];
  } catch { return []; }
}
