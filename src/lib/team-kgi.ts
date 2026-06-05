// チーム（部署）KGI の型・取得・算出（純粋）。稼働数ドリブン版。
//   サーバー/クライアント両方から import 可能（"use server" は付けない）。
//   保存処理（Server Action）は team-kgi-actions.ts に分離。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type TeamKgi = {
  id: string;
  department: string;
  month: string;                 // 'YYYY-MM-01'
  active_current: number | null; // 現在の稼働数
  active_add: number | null;     // 今月増やす目標（人数）
  rate_per_head_man: number | null;  // 1名あたり平均月額売上（万円）
  gross_per_head_man: number | null; // 1名あたり平均月額粗利（万円）
  dropout_allowed: number | null;    // 許容離脱数（目標0）
  note: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

export type TeamKgiInput = {
  department: string;
  month: string;                 // 'YYYY-MM-01'
  active_current: number | null;
  active_add: number | null;
  rate_per_head_man: number | null;
  gross_per_head_man: number | null;
  dropout_allowed: number | null;
  note?: string | null;
};

/** 稼働数から売上・利益を算出（紐づけ）。すべて月額・万円ベース。 */
export function projectKgi(v: {
  active_current?: number | null;
  active_add?: number | null;
  rate_per_head_man?: number | null;
  gross_per_head_man?: number | null;
}) {
  const cur = v.active_current ?? 0;
  const add = v.active_add ?? 0;
  const target = cur + add;
  const rate = v.rate_per_head_man ?? 0;
  const gross = v.gross_per_head_man ?? 0;
  return {
    current: cur,
    add,
    target,                                   // 目標稼働数
    monthlyRevenueMan: target * rate,         // 目標稼働での月間売上見込み（万円）
    monthlyGrossMan: target * gross,          // 目標稼働での月間粗利見込み（万円）
    addedRevenueMan: add * rate,              // 増分が生む月間売上（万円）
    addedGrossMan: add * gross,               // 増分が生む月間粗利（万円）
  };
}

/** 当月の月初（YYYY-MM-01）。表示・保存の既定として使う。 */
export function currentMonthKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** 指定部署・指定月のKGIを取得（無ければ null）。サーバー側で呼ぶ。 */
export async function getTeamKgi(department: string, month: string): Promise<TeamKgi | null> {
  if (!dbConfigured || !department || !month) return null;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("team_kgi")
      .select("id, department, month, active_current, active_add, rate_per_head_man, gross_per_head_man, dropout_allowed, note, updated_by_name, updated_at")
      .eq("department", department).eq("month", month).maybeSingle();
    if (error) return null;
    return (data as TeamKgi) ?? null;
  } catch { return null; }
}
