// チーム（部署）KGI の型・定数・純粋関数。
//   サーバー/クライアント両方から import 可能（"use server" は付けない）。
//   保存処理など Server Action は team-kgi-actions.ts に分離。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type KgiMetric = "gross_profit_man" | "active_engineers" | "dropout";

export const KGI_METRICS: { key: KgiMetric; label: string; unit: string; hint: string }[] = [
  { key: "gross_profit_man", label: "月間粗利",                 unit: "万円", hint: "チームが月内に創出する粗利の目標レンジ" },
  { key: "active_engineers", label: "稼働中エンジニア（月末）", unit: "名",   hint: "月末時点で稼働中の累計人数" },
  { key: "dropout",          label: "稼働中エンジニアの離脱",   unit: "名",   hint: "月内に稼働を離脱した人数（0が目標）" },
];

export type TeamKgiRow = {
  id: string;
  department: string;
  month: string;      // 'YYYY-MM-01'
  metric: KgiMetric;
  target_min: number | null;
  target_max: number | null;
  note: string | null;
  updated_by_email: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export type TeamKgiInput = {
  department: string;
  month: string;       // 'YYYY-MM-01'
  metric: KgiMetric;
  target_min: number | null;
  target_max: number | null;
  note?: string | null;
};

/** 当月の月初（YYYY-MM-01）。表示・保存の既定として使う。 */
export function currentMonthKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** 指定部署・指定月のKGI行をすべて取得（最大3メトリクス）。サーバー側で呼ぶ。 */
export async function listTeamKgi(department: string, month: string): Promise<TeamKgiRow[]> {
  if (!dbConfigured || !department || !month) return [];
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("team_kgi")
      .select("id, department, month, metric, target_min, target_max, note, updated_by_email, updated_by_name, updated_at")
      .eq("department", department).eq("month", month);
    if (error) return [];
    return (data ?? []) as TeamKgiRow[];
  } catch { return []; }
}
