// KGIダッシュボード：月間売上目標 → KPI逆算プランの型・既定値・純粋計算・読み出し。
//   型と純粋関数はクライアントからも import する（型は import type で erase、値はサーバー専用）。
import { engerAdmin, engerClient, dbConfigured } from "@/lib/supabase";

// 逆算で用いる転換率と平均単価。AIが状況に合わせて調整するが、未設定/AI無効時はこの既定値。
export type KgiConv = {
  appointmentToProposal: number; // 打ち合わせ→提案（例 0.5）
  proposalToMeeting: number;     // 提案→面談（例 0.2）
  meetingToPlacement: number;    // 面談→稼働（例 0.33）
};
export const DEFAULT_AVG_DEAL_MAN = 60;      // 1稼働あたり月額（万円）の既定
export const DEFAULT_CONV: KgiConv = { appointmentToProposal: 0.5, proposalToMeeting: 0.2, meetingToPlacement: 0.33 };

export type KgiMonthly = { placement: number; meeting: number; proposal: number; appointment: number };
export type KgiPlan = { avgDealMan: number; conv: KgiConv; monthly: KgiMonthly; rationale?: string };
export type KgiSalesPlanRow = {
  month: string;
  salesTargetMan: number | null;
  plan: KgiPlan | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

// 逆算：売上目標(万円) と 前提 から月次KPI件数を求める（AIが選んだ前提を、件数はコードで確定させる）。
//   稼働人数 = 売上 ÷ 平均単価、面談 = 稼働 ÷ (面談→稼働)、提案 = 面談 ÷ (提案→面談)、打ち合わせ = 提案 ÷ (打合せ→提案)。
export function monthlyFromTarget(salesTargetMan: number, avgDealMan: number, conv: KgiConv): KgiMonthly {
  const t = Math.max(0, Number(salesTargetMan) || 0);
  const deal = Math.max(1, Number(avgDealMan) || DEFAULT_AVG_DEAL_MAN);
  const c1 = clampRate(conv.meetingToPlacement, DEFAULT_CONV.meetingToPlacement);
  const c2 = clampRate(conv.proposalToMeeting, DEFAULT_CONV.proposalToMeeting);
  const c3 = clampRate(conv.appointmentToProposal, DEFAULT_CONV.appointmentToProposal);
  const placement = Math.ceil(t / deal);
  const meeting = Math.ceil(placement / c1);
  const proposal = Math.ceil(meeting / c2);
  const appointment = Math.ceil(proposal / c3);
  return { placement, meeting, proposal, appointment };
}
export function clampRate(v: unknown, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0.001 && n <= 1 ? n : def;
}
export function clampDeal(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 5 && n <= 1000 ? n : DEFAULT_AVG_DEAL_MAN;
}

/** 月間売上目標＋AIプランを読み出す（サーバー専用）。 */
export async function getKgiSalesPlan(month: string): Promise<KgiSalesPlanRow | null> {
  if (!dbConfigured || !month) return null;
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const r: any = await sb.from("kgi_sales_plan")
      .select("month, sales_target_man, plan, updated_by_name, updated_at")
      .eq("month", month).maybeSingle();
    if (r.error || !r.data) return null;
    return {
      month,
      salesTargetMan: r.data.sales_target_man != null ? Number(r.data.sales_target_man) : null,
      plan: (r.data.plan ?? null) as KgiPlan | null,
      updatedByName: r.data.updated_by_name ?? null,
      updatedAt: r.data.updated_at ?? null,
    };
  } catch { return null; }
}
