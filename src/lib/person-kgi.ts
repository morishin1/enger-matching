// 個人月次KGI（稼働化目標）の取得・逆算ヘルパ。
//   保存処理（Server Action）は person-kgi-actions.ts に分離（"use server"の制約）。
//
//   逆算の考え方：
//     月次稼働化目標 → 全社の総合転換率（提案→稼働化）から必要な月次提案数を算出
//     → ÷ 月内営業日 → 1日あたり提案目標（=日次KPI）
//     → × 5 → 1週間の提案目標（=週次KPI）

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type PersonKgi = {
  id: string;
  owner_email: string;
  owner_name: string | null;
  department: string | null;
  month: string;                    // YYYY-MM-01
  placement_target: number | null;  // 月内稼働化目標
  note: string | null;
  updated_by_name: string | null;
  updated_at: string | null;
};

export type PersonKgiInput = {
  owner_email: string;
  owner_name?: string | null;
  department?: string | null;
  month: string;                    // YYYY-MM-01
  placement_target: number | null;
  note?: string | null;
};

/** 当月の月初。 */
export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/** その月の営業日数（土日除外）。祝日は考慮しない簡易版。 */
export function businessDaysInMonth(month: string): number {
  const [y, m] = month.split("-").map((x) => Number(x));
  const last = new Date(y, m, 0).getDate();
  let count = 0;
  for (let day = 1; day <= last; day++) {
    const dow = new Date(y, m - 1, day).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** 指定メンバーの当月個人KGIを取得。 */
export async function getPersonKgi(ownerEmail: string, month: string): Promise<PersonKgi | null> {
  if (!dbConfigured || !ownerEmail || !month) return null;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("person_kgi")
      .select("id, owner_email, owner_name, department, month, placement_target, note, updated_by_name, updated_at")
      .eq("owner_email", ownerEmail.toLowerCase()).eq("month", month).maybeSingle();
    if (error) return null;
    return (data as PersonKgi) ?? null;
  } catch { return null; }
}

/** 指定月の個人KGI一覧（管理者・マネージャー用）。 */
export async function listPersonKgi(month: string, scope?: { department?: string | null }): Promise<PersonKgi[]> {
  if (!dbConfigured || !month) return [];
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    let q: any = sb.from("person_kgi")
      .select("id, owner_email, owner_name, department, month, placement_target, note, updated_by_name, updated_at")
      .eq("month", month);
    if (scope?.department) q = q.eq("department", scope.department);
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as PersonKgi[];
  } catch { return []; }
}

/** 月→週→日 の逆算結果。 */
export type KgiPlan = {
  placementTarget: number;     // 月次稼働化目標
  conversion: number | null;   // 提案→稼働化の総合転換率（0〜1）
  monthlyProposals: number | null;  // 月内に必要な提案数（=目標÷転換率）
  weeklyProposals: number | null;   // 週あたり（月÷4.33）
  dailyProposals: number | null;    // 日あたり（月÷営業日）
  bizDays: number;
};

/** 個人月次KGI＋全社転換率から、月/週/日の提案目標を逆算。 */
export function planFromTarget(placementTarget: number, conversion: number | null, month: string): KgiPlan {
  const bizDays = businessDaysInMonth(month);
  if (!placementTarget || placementTarget <= 0 || !conversion || conversion <= 0) {
    return { placementTarget: placementTarget || 0, conversion, monthlyProposals: null, weeklyProposals: null, dailyProposals: null, bizDays };
  }
  const monthly = Math.ceil(placementTarget / conversion);
  return {
    placementTarget,
    conversion,
    monthlyProposals: monthly,
    weeklyProposals: Math.ceil(monthly / 4.33),
    dailyProposals: Math.ceil(monthly / Math.max(1, bizDays)),
    bizDays,
  };
}
