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

// 現実的な稼働容量：1人が1営業日にこなせる打ち合わせ（商談）の上限。SES現場の実感値（1人1日3件が限度）。
export const DEFAULT_MTG_PER_PERSON_DAY = 3;

// インサイド/アウトサイドの人員配分。打ち合わせ（商談）はチーム全員でこなす前提で容量を見積る。
export type KgiHeadcount = { inside: number; outside: number };

export type KgiMonthly = { placement: number; meeting: number; proposal: number; appointment: number };
export type KgiPlan = {
  avgDealMan: number;
  conv: KgiConv;
  monthly: KgiMonthly;
  headcount?: KgiHeadcount;        // 逆算時点の人員配分（記録用）
  mtgPerPersonDay?: number;        // 打ち合わせ/人日 の上限（既定 DEFAULT_MTG_PER_PERSON_DAY）
  feasible?: boolean;              // 打ち合わせ目標が人員容量に収まるか
  advice?: string;                 // 実現条件（増員/単価↑/転換率↑/エンド直・FL・BP・PP採用 など）
  rationale?: string;
};
// 週次カレンダーの目標上書き（KPIキー→週配列）。未保存の週インデックスは自動配分にフォールバック。
export type KgiWeekOverrides = Partial<Record<keyof KgiMonthly, (number | null)[]>>;
export type KgiSalesPlanRow = {
  month: string;
  salesTargetMan: number | null;
  avgDealMan: number | null;       // 平均単価（万円/名・月）＝手入力。逆算の分母。
  headcount: KgiHeadcount;
  plan: KgiPlan | null;
  weekOverrides: KgiWeekOverrides | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

/** チームの月間打ち合わせ容量（件）＝ (inside+outside) × 1人1日の上限 × 当月営業日。 */
export function meetingCapacityMonth(headcount: KgiHeadcount, bizDays: number, perDay = DEFAULT_MTG_PER_PERSON_DAY): number {
  const heads = Math.max(0, Math.floor(headcount.inside) + Math.floor(headcount.outside));
  return Math.max(0, heads) * Math.max(0, perDay) * Math.max(0, bizDays);
}

/** 月次目標に対する「今日までの想定進捗」と、遅れを取り戻すための必要日次ペースを求める（純粋計算）。 */
export type KgiRecovery = {
  remainingDays: number;   // 残り営業日
  expectedToDate: number;  // 今日までに達成しているべき件数（線形按分）
  gap: number;             // 実績 − 想定（＋なら貯金 / −なら遅れ）
  behind: boolean;         // 遅れているか
  requiredDaily: number;   // 残り期間で必要な日次ペース（未達分 ÷ 残営業日）
  normalDaily: number;     // 当初の日次ペース（月次 ÷ 総営業日）
  catchUp: boolean;        // 必要ペースが当初ペースを上回るか（リカバリーが必要）
};
export function recoveryPace(monthlyTarget: number, bizDaysTotal: number, bizDaysElapsed: number, actualToDate: number): KgiRecovery {
  const total = Math.max(0, bizDaysTotal);
  const elapsed = Math.min(Math.max(0, bizDaysElapsed), total);
  const remainingDays = Math.max(0, total - elapsed);
  const expectedToDate = total > 0 ? (monthlyTarget * elapsed) / total : 0;
  const gap = actualToDate - expectedToDate;
  const remaining = Math.max(0, monthlyTarget - actualToDate);
  const requiredDaily = remainingDays > 0 ? remaining / remainingDays : remaining;
  const normalDaily = total > 0 ? monthlyTarget / total : 0;
  return { remainingDays, expectedToDate, gap, behind: gap < -0.5, requiredDaily, normalDaily, catchUp: requiredDaily > normalDaily + 1e-9 };
}

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
    // headcount / avg_deal_man 列は後追いマイグレーション。無い環境でも動くようフォールバック。
    const cols = "month, sales_target_man, avg_deal_man, inside_count, outside_count, plan, week_overrides, updated_by_name, updated_at";
    let r: any = await sb.from("kgi_sales_plan").select(cols).eq("month", month).maybeSingle();
    if (r.error && /week_overrides|column/i.test(r.error.message ?? "")) {
      r = await sb.from("kgi_sales_plan").select("month, sales_target_man, avg_deal_man, inside_count, outside_count, plan, updated_by_name, updated_at").eq("month", month).maybeSingle();
    }
    if (r.error && /avg_deal_man|inside_count|outside_count|column/i.test(r.error.message ?? "")) {
      r = await sb.from("kgi_sales_plan").select("month, sales_target_man, inside_count, outside_count, plan, updated_by_name, updated_at").eq("month", month).maybeSingle();
    }
    if (r.error && /inside_count|outside_count|column/i.test(r.error.message ?? "")) {
      r = await sb.from("kgi_sales_plan").select("month, sales_target_man, plan, updated_by_name, updated_at").eq("month", month).maybeSingle();
    }
    if (r.error || !r.data) return null;
    return {
      month,
      salesTargetMan: r.data.sales_target_man != null ? Number(r.data.sales_target_man) : null,
      avgDealMan: r.data.avg_deal_man != null ? Number(r.data.avg_deal_man) : null,
      headcount: {
        inside: r.data.inside_count != null ? Math.max(0, Math.floor(Number(r.data.inside_count))) : 0,
        outside: r.data.outside_count != null ? Math.max(0, Math.floor(Number(r.data.outside_count))) : 0,
      },
      plan: (r.data.plan ?? null) as KgiPlan | null,
      weekOverrides: (r.data.week_overrides ?? null) as KgiWeekOverrides | null,
      updatedByName: r.data.updated_by_name ?? null,
      updatedAt: r.data.updated_at ?? null,
    };
  } catch { return null; }
}
