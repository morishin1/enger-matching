// 副業エージェント(freelance)の報酬計算。
//   ルール: 自分が登録(operator=本人メール)した人材または案件で稼働中のエンゲージメントについて、
//          月額の commission_rate% を月間報酬として算出。デフォルトは 3%。
//          envで上書き可: AGENT_COMMISSION_RATE_PCT
import { engerAdmin, dbConfigured } from "./supabase";

export const COMMISSION_RATE_PCT = Math.max(0, Math.min(50, Number(process.env.AGENT_COMMISSION_RATE_PCT || 3)));

export type CommissionEntry = {
  engagement_id: string;
  candidate_name: string | null;
  job_title: string | null;
  monthly_rate: number;       // 万円
  via: "人材" | "案件";        // 自分の登録経路
  monthly_commission: number; // 万円
};

export type CommissionReport = {
  available: boolean;
  ratePct: number;
  totalMonthlyMan: number;      // 月額の自分の取り分（万円）
  annualEstimateMan: number;    // 年換算
  count: number;                // 対象稼働数
  entries: CommissionEntry[];
};

const parseMan = (rate?: number | string | null): number => {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate >= 10000 ? Math.round(rate / 10000) : Math.round(rate);
  const m = String(rate).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/万/.test(rate)) return Math.round(n);
  if (n >= 10000) n = n / 10000;
  return Math.round(n);
};

/**
 * 自分が登録した人材/案件で稼働中のエンゲージメントから報酬を算出。
 * operator フィールドにメール（または名前）が一致するものを自分の登録とみなす。
 */
export async function getFreelanceCommission(operator: string): Promise<CommissionReport> {
  const empty: CommissionReport = { available: false, ratePct: COMMISSION_RATE_PCT, totalMonthlyMan: 0, annualEstimateMan: 0, count: 0, entries: [] };
  if (!operator || !dbConfigured) return empty;
  try {
    const admin = engerAdmin();
    // 自分が登録した人材/案件（operator = 本人）
    const candIds = new Set<string>();
    const jobIds = new Set<string>();
    {
      const c: any = await admin.from("candidates").select("id, operator").ilike("operator", operator).limit(5000);
      if (!c.error) for (const r of (c.data ?? [])) if (r.id) candIds.add(r.id);
    }
    {
      const j: any = await admin.from("jobs").select("id, operator").ilike("operator", operator).limit(5000);
      if (!j.error) for (const r of (j.data ?? [])) if (r.id) jobIds.add(r.id);
    }
    if (candIds.size === 0 && jobIds.size === 0) return { ...empty, available: true };

    // 稼働中(or 予定)のエンゲージメント＋紐づく提案
    const eng: any = await admin.from("engagements")
      .select("id, proposal_id, monthly_rate, status")
      .in("status", ["稼働中", "予定"]).limit(2000);
    if (eng.error) return { ...empty, available: false };
    const props: any = await admin.from("proposals")
      .select("id, job_id, candidate_id, job_title, candidate_name")
      .in("id", (eng.data ?? []).map((e: any) => e.proposal_id).filter(Boolean));
    const pmap = new Map<string, any>();
    for (const p of (props.data ?? [])) pmap.set(p.id, p);

    const entries: CommissionEntry[] = [];
    for (const e of (eng.data ?? [])) {
      const p = pmap.get(e.proposal_id);
      if (!p) continue;
      const viaCand = candIds.has(p.candidate_id);
      const viaJob = jobIds.has(p.job_id);
      if (!viaCand && !viaJob) continue;
      const man = parseMan(e.monthly_rate);
      const commission = Math.round((man * COMMISSION_RATE_PCT) / 100 * 100) / 100; // 小数2位
      entries.push({
        engagement_id: e.id,
        candidate_name: p.candidate_name ?? null,
        job_title: p.job_title ?? null,
        monthly_rate: man,
        via: viaCand ? "人材" : "案件",
        monthly_commission: commission,
      });
    }
    const totalMonthlyMan = Math.round(entries.reduce((s, x) => s + x.monthly_commission, 0) * 100) / 100;
    return {
      available: true,
      ratePct: COMMISSION_RATE_PCT,
      totalMonthlyMan,
      annualEstimateMan: Math.round(totalMonthlyMan * 12 * 10) / 10,
      count: entries.length,
      entries,
    };
  } catch { return empty; }
}
