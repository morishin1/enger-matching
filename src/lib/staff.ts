import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";
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

/** 担当者マスタを取得（120秒キャッシュ）。スタッフ編集時は revalidateTag("staff") で更新。 */
export const getStaff = unstable_cache(fetchStaff, ["staff-master"], { revalidate: 120, tags: ["staff"] });

/** 担当者マスタを取得。テーブル未作成時は定数にフォールバック。 */
async function fetchStaff(): Promise<{ rows: Staff[]; proposers: string[]; closers: string[]; members: string[]; fromTable: boolean }> {
  if (dbConfigured) {
    try {
      const sb = engerClient();
      let res: any = await sb.from("staff").select("id, name, email, is_proposer, is_closer, active, sort, position").eq("active", true).order("sort", { ascending: true });
      if (res.error) res = await sb.from("staff").select("id, name, email, is_proposer, is_closer, active, sort").eq("active", true).order("sort", { ascending: true });
      if (res.error) res = await sb.from("staff").select("id, name, is_proposer, is_closer, active, sort").eq("active", true).order("sort", { ascending: true });
      const { data, error } = res;
      if (!error && data) {
        const rows = data as Staff[];
        const members = rows.map((s) => s.name);
        return {
          rows,
          // 区分(インサイド/アウトサイド)に関係なく、全員が提案・クロージング担当になれる
          proposers: members,
          closers: ["未割当", ...members],
          members,
          fromTable: true,
        };
      }
    } catch { /* fallthrough */ }
  }
  // フォールバック（staff.sql 未実行時）
  return { rows: [], proposers: PROPOSERS, closers: CLOSERS, members: PROPOSERS, fromTable: false };
}
