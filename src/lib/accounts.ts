import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type Role = "admin" | "agent" | "client";
export type AccountStatus = "pending" | "active" | "disabled";
export type Account = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccountStatus;
  company_name: string | null;
  note: string | null;
  created_at: string;
  approved_at: string | null;
};

/** ロール別の初期表示パス。client も自社ポータル(=ダッシュボード"/")へ。 */
export function roleHome(_role: Role): string {
  return "/";
}

/** admin 専用ルート（営業も不可）。 */
const ADMIN_PREFIXES = ["/settings"];
/** client(ユーザー企業) が開けるルート。ここ以外は自社ポータル"/"へ戻す。 */
const CLIENT_ALLOWED = ["/"];

/** 指定ロールが pathname にアクセスできるか。 */
export function canAccess(role: Role, pathname: string): boolean {
  if (role === "admin") return true;
  const hit = (list: string[]) => list.some((p) => p === "/" ? pathname === "/" : (pathname === p || pathname.startsWith(p + "/")));
  if (role === "agent") return !hit(ADMIN_PREFIXES);  // 営業は settings 以外すべて可
  // client: 自社ポータル(ダッシュボード)のみ。他の内部画面はデータ分離前のため非表示。
  return hit(CLIENT_ALLOWED);
}

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
export async function resolveAccess(email: string): Promise<{ role: Role; status: AccountStatus; companyName: string | null; name: string | null } | null> {
  const acc = await getAccountByEmail(email);
  if (acc) return { role: acc.role, status: acc.status, companyName: acc.company_name, name: acc.name };

  // フォールバック: 既存 staff 許可リスト → admin
  const e = (email || "").toLowerCase().trim();
  if (!e || !dbConfigured) return null;
  try {
    const sb = engerClient();
    const { data, error } = await sb.from("staff").select("name, email").eq("active", true).not("email", "is", null);
    if (error) return { role: "admin", status: "active", companyName: null, name: null }; // staff未整備=初期は素通り(admin)
    const rows = (data ?? []) as { name: string; email: string | null }[];
    const allow = rows.map((r) => String(r.email || "").toLowerCase()).filter(Boolean);
    if (allow.length === 0) return { role: "admin", status: "active", companyName: null, name: null };
    if (allow.includes(e)) {
      const me = rows.find((r) => String(r.email || "").toLowerCase() === e);
      return { role: "admin", status: "active", companyName: null, name: me?.name ?? null };
    }
    return null;
  } catch { return null; }
}

/** 承認待ちアカウントを作成（自己登録 / Google初回）。既存はそのまま。 */
export async function createPendingAccount(opts: { email: string; name?: string | null; role?: "agent" | "client"; companyName?: string | null }): Promise<{ ok: boolean; created: boolean; error?: string }> {
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
    return { ok: true, created: true };
  } catch (err: any) { return { ok: false, created: false, error: String(err?.message ?? err) }; }
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
