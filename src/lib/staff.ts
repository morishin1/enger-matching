import { engerClient, dbConfigured } from "./supabase";
import { PROPOSERS, CLOSERS } from "./proposal-constants";

export type Staff = { id: string; name: string; email: string | null; is_proposer: boolean; is_closer: boolean; active: boolean; sort: number };

/** 担当者マスタを取得。テーブル未作成時は定数にフォールバック。 */
export async function getStaff(): Promise<{ rows: Staff[]; proposers: string[]; closers: string[]; fromTable: boolean }> {
  if (dbConfigured) {
    try {
      const sb = engerClient();
      let res: any = await sb.from("staff").select("id, name, email, is_proposer, is_closer, active, sort").eq("active", true).order("sort", { ascending: true });
      if (res.error) res = await sb.from("staff").select("id, name, is_proposer, is_closer, active, sort").eq("active", true).order("sort", { ascending: true });
      const { data, error } = res;
      if (!error && data) {
        const rows = data as Staff[];
        return {
          rows,
          proposers: rows.filter((s) => s.is_proposer).map((s) => s.name),
          closers: ["未割当", ...rows.filter((s) => s.is_closer).map((s) => s.name)],
          fromTable: true,
        };
      }
    } catch { /* fallthrough */ }
  }
  // フォールバック（staff.sql 未実行時）
  return { rows: [], proposers: PROPOSERS, closers: CLOSERS, fromTable: false };
}
