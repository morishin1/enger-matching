// ファネル（転換率）集計。Phase 0「まず自社の歩留まりを知る」ための土台。
//   段階：提案 → 面談 → クロージング(CL) → 稼働化
//   数え方は既存KPIダッシュボード(kpi.ts)と統一する：
//     - 提案  : proposals.created_at が期間内
//     - 面談  : meetings.meeting_date が期間内
//     - CL    : proposals.stage='クロージング中' かつ stage_updated_at が期間内
//     - 稼働化: proposals.stage∈('稼働決定','稼働') かつ stage_updated_at が期間内
//     - 失注  : proposals.stage='失注' かつ stage_updated_at が期間内
//   ※ コホート厳密ではなく「期間内フロー」での歩留まり目安（小さく始めるための実用値）。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { listAccounts } from "./accounts";

export type FunnelCounts = { proposal: number; meeting: number; cl: number; won: number; lost: number };
export type DeptFunnel = { dept: string; counts: FunnelCounts };
export type FunnelResult = {
  available: boolean;
  total: FunnelCounts;
  byDept: DeptFunnel[];
  periodLabel: string;
};

export type FunnelPeriod = "this_month" | "last_month" | "last_3_months";

/** 期間キー → [start, end)（end は排他）と表示ラベル。 */
export function resolveFunnelPeriod(key: FunnelPeriod, now = new Date()): { start: Date; end: Date; label: string } {
  const y = now.getFullYear(), m = now.getMonth();
  if (key === "last_month") {
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), label: "先月" };
  }
  if (key === "last_3_months") {
    return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1), label: "直近3ヶ月" };
  }
  return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: "今月" };
}

const emptyCounts = (): FunnelCounts => ({ proposal: 0, meeting: 0, cl: 0, won: 0, lost: 0 });

export async function getFunnel(start: Date, end: Date, periodLabel: string): Promise<FunnelResult> {
  if (!dbConfigured) return { available: false, total: emptyCounts(), byDept: [], periodLabel };

  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }

  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const startDate = startIso.slice(0, 10);
  const endDate = endIso.slice(0, 10);

  // 氏名 → 部署 の対応（部署別ファネル用）
  let deptByName = new Map<string, string | null>();
  try {
    const accs = await listAccounts();
    deptByName = new Map(accs.filter((a) => a.name).map((a) => [a.name!, (a as any).department ?? null] as const));
  } catch { /* 部署不明でも全社集計は続行 */ }

  let props: any[] = [];
  let meets: any[] = [];
  try {
    const [pr, mr] = await Promise.all([
      sb.from("proposals")
        .select("proposer, closer, stage, created_at, stage_updated_at")
        .or(`created_at.gte.${startIso},stage_updated_at.gte.${startIso}`)
        .limit(20000),
      sb.from("meetings")
        .select("our_owner, meeting_date")
        .gte("meeting_date", startDate).lt("meeting_date", endDate)
        .limit(20000),
    ]);
    props = pr.error ? [] : (pr.data ?? []);
    meets = mr.error ? [] : (mr.data ?? []);
  } catch {
    return { available: false, total: emptyCounts(), byDept: [], periodLabel };
  }

  const inRange = (d: string | null) => !!d && d >= startIso && d < endIso;
  const total = emptyCounts();
  const deptMap = new Map<string, FunnelCounts>();
  const bump = (dept: string | null | undefined, key: keyof FunnelCounts) => {
    if (!dept) return;
    if (!deptMap.has(dept)) deptMap.set(dept, emptyCounts());
    deptMap.get(dept)![key]++;
  };

  for (const p of props) {
    const pDept = deptByName.get(p.proposer) ?? deptByName.get(p.closer) ?? null;
    if (inRange(p.created_at)) {
      total.proposal++;
      bump(deptByName.get(p.proposer) ?? null, "proposal");
    }
    if (inRange(p.stage_updated_at)) {
      if (p.stage === "クロージング中") { total.cl++; bump(pDept, "cl"); }
      else if (p.stage === "稼働決定" || p.stage === "稼働") { total.won++; bump(pDept, "won"); }
      else if (p.stage === "失注") { total.lost++; bump(pDept, "lost"); }
    }
  }
  for (const m of meets) {
    if (m.meeting_date >= startDate && m.meeting_date < endDate) {
      total.meeting++;
      bump(deptByName.get(m.our_owner) ?? null, "meeting");
    }
  }

  const byDept: DeptFunnel[] = Array.from(deptMap.entries())
    .map(([dept, counts]) => ({ dept, counts }))
    .sort((a, b) => b.counts.won - a.counts.won || b.counts.proposal - a.counts.proposal);

  return { available: true, total, byDept, periodLabel };
}

/** 転換率（0〜1）。分母0は null。 */
export function rate(numer: number, denom: number): number | null {
  if (denom <= 0) return null;
  return numer / denom;
}

export const pct = (r: number | null): string => (r == null ? "—" : `${Math.round(r * 100)}%`);
