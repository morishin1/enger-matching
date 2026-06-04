import { unstable_cache } from "next/cache";
import { engerClient, engerAdmin, dbConfigured } from "./supabase";
import { PROPOSERS, CLOSERS } from "./proposal-constants";

export type Staff = { id: string; name: string; email: string | null; is_proposer: boolean; is_closer: boolean; active: boolean; sort: number; position?: "inside" | "outside" | null };

/** ログイン許可判定：担当者マスタに email が1件でもあれば許可リスト方式、無ければ全許可(初期)。 */
export async function isAllowedEmail(email: string): Promise<boolean> {
  const e = (email || "").toLowerCase().trim();
  if (!e) return false;
  if (!dbConfigured) return true;
  try {
    const sb = engerClient();
    const { data, error } = await sb.from("staff").select("email").eq("active", true).not("email", "is", null);
    if (error) return true; // staff未整備時は素通り
    const allow = (data ?? []).map((r: any) => String(r.email || "").toLowerCase()).filter(Boolean);
    return allow.length === 0 || allow.includes(e);
  } catch { return true; }
}

/** 社内メンバー（提案者/クロージング担当の選択肢）を取得（120秒キャッシュ）。アカウント編集時は revalidateTag("staff") で更新。 */
export const getStaff = unstable_cache(fetchStaff, ["staff-master"], { revalidate: 120, tags: ["staff"] });

/**
 * 社内メンバーを「アカウント・権限管理（app_users）」から生成。
 *   - 対象：status=active かつ role が admin / agent（＝社内ユーザー。client企業は除外）
 *   - 全員が提案者・クロージング担当の候補になれる（区分は問わない）
 *   担当者マスタ(staff)は廃止し、アカウント1か所に統合。
 */
async function fetchStaff(): Promise<{ rows: Staff[]; proposers: string[]; closers: string[]; members: string[]; fromTable: boolean }> {
  if (dbConfigured) {
    try {
      const sb = engerAdmin();
      const { data, error } = await sb.from("app_users")
        .select("id, name, email, role, position")
        .eq("status", "active")
        .in("role", ["admin", "agent"])
        .order("name", { ascending: true });
      if (!error && data) {
        const rows: Staff[] = (data as any[])
          .filter((u) => String(u.name ?? "").trim())
          .map((u, i) => ({ id: u.id, name: String(u.name), email: u.email ?? null, is_proposer: true, is_closer: true, active: true, sort: i, position: (u.position ?? null) as Staff["position"] }));
        const members = Array.from(new Set(rows.map((s) => s.name)));
        return { rows, proposers: members, closers: ["未割当", ...members], members, fromTable: true };
      }
    } catch { /* fallthrough */ }
  }
  // フォールバック（accounts.sql 未実行時）
  return { rows: [], proposers: PROPOSERS, closers: CLOSERS, members: PROPOSERS, fromTable: false };
}
