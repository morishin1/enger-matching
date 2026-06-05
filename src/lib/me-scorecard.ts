// 本人の今日/今週/今月のファネルと、個人KGIから逆算した「今日の目標」を集計。
//   日報の上部に表示するスコアカード用。
//   定義は kpi.ts / funnel.ts と統一：
//     提案:created_at, 面談:meetings.meeting_date,
//     CL:stage='クロージング中'@stage_updated_at, 稼働化:stage∈('稼働決定','稼働')@stage_updated_at

import { engerAdmin, engerClient, dbConfigured } from "./supabase";
import { getFunnel, resolveFunnelPeriod, rate } from "./funnel";
import { getPersonKgi, monthKey, planFromTarget, type KgiPlan } from "./person-kgi";

export type ScorecardCounts = { proposal: number; meeting: number; cl: number; won: number };

export type MeScorecard = {
  available: boolean;
  today: ScorecardCounts;
  week: ScorecardCounts;     // 月曜起点（今週）
  month: ScorecardCounts;    // 今月（1日〜末日）
  monthPlacedTotal: number;  // 提案者+クローザーの合計（個人KGI評価用）
  plan: KgiPlan | null;      // 月→週→日の提案目標
  placementTarget: number | null; // 個人月次稼働化目標
  conversion: number | null;      // 全社の総合転換率（提案→稼働化）
};

const jstStartOfWeek = (d = new Date()): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  // 月曜起点
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
};

const emptyCounts = (): ScorecardCounts => ({ proposal: 0, meeting: 0, cl: 0, won: 0 });

/** 本人の今日・今週・今月のファネルと、個人KGI逆算プランをまとめて取得。 */
export async function getMyScorecard(name: string | null, email: string | null, now = new Date()): Promise<MeScorecard> {
  const empty: MeScorecard = {
    available: false, today: emptyCounts(), week: emptyCounts(), month: emptyCounts(),
    monthPlacedTotal: 0, plan: null, placementTarget: null, conversion: null,
  };
  if (!dbConfigured || !name) return empty;

  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const weekStart = jstStartOfWeek(now);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);

  const iso = (d: Date) => d.toISOString();
  const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

  // 1) 全社転換率（今月のファネル）
  const funnelP = (async () => {
    const { start, end, label } = resolveFunnelPeriod("this_month", now);
    const f = await getFunnel(start, end, label);
    return rate(f.total.won, f.total.proposal);
  })();

  // 2) 個人月次KGI
  const kgiP = email ? getPersonKgi(email.toLowerCase(), monthKey(now)) : Promise.resolve(null);

  // 3) 本人の proposals / meetings を今月ぶん取得（period内をJSで分配）
  const propsP = sb.from("proposals")
    .select("proposer, closer, stage, created_at, stage_updated_at")
    .or(`created_at.gte.${iso(monthStart)},stage_updated_at.gte.${iso(monthStart)}`)
    .or(`proposer.eq.${name},closer.eq.${name}`)
    .limit(5000);
  const meetsP = sb.from("meetings")
    .select("our_owner, meeting_date")
    .eq("our_owner", name)
    .gte("meeting_date", dateOnly(monthStart)).lt("meeting_date", dateOnly(monthEnd))
    .limit(2000);
  // 4) 今月の自分稼働化（提案者+クローザー合算）→ engagementsから引く
  const engsP = sb.from("engagements")
    .select("proposal_id, created_at")
    .gte("created_at", iso(monthStart)).lt("created_at", iso(monthEnd))
    .limit(2000);

  const [conv, kgi, pr, mr, er] = await Promise.all([funnelP, kgiP, propsP, meetsP, engsP]);
  const props: any[] = (pr as any).error ? [] : ((pr as any).data ?? []);
  const meets: any[] = (mr as any).error ? [] : ((mr as any).data ?? []);
  const engs: any[]  = (er as any).error ? [] : ((er as any).data ?? []);

  // proposal_id → proposer/closer
  let monthPlacedTotal = 0;
  if (engs.length > 0) {
    const ids = Array.from(new Set(engs.map((e) => e.proposal_id).filter(Boolean)));
    if (ids.length > 0) {
      const ep = await sb.from("proposals").select("id, proposer, closer").in("id", ids).limit(3000);
      const map = new Map<string, { proposer: string | null; closer: string | null }>();
      for (const p of ((ep as any).data ?? []) as any[]) map.set(p.id, { proposer: p.proposer ?? null, closer: p.closer ?? null });
      for (const e of engs) {
        const p = map.get(e.proposal_id);
        if (!p) continue;
        if (p.proposer === name) monthPlacedTotal++;
        if (p.closer === name && p.closer !== p.proposer) monthPlacedTotal++; // 同一人の二重カウント防止
      }
    }
  }

  // 各期間にファネルを積む
  const acc = (range: { s: Date; e: Date }, counts: ScorecardCounts) => {
    const sIso = iso(range.s), eIso = iso(range.e);
    const sDate = dateOnly(range.s), eDate = dateOnly(range.e);
    const inRangeIso = (d: string | null) => !!d && d >= sIso && d < eIso;
    for (const p of props) {
      const mine = p.proposer === name || p.closer === name;
      if (!mine) continue;
      if (inRangeIso(p.created_at) && p.proposer === name) counts.proposal++;
      if (inRangeIso(p.stage_updated_at)) {
        if (p.stage === "クロージング中") counts.cl++;
        else if (p.stage === "稼働決定" || p.stage === "稼働") counts.won++;
      }
    }
    for (const m of meets) {
      if (m.meeting_date >= sDate && m.meeting_date < eDate) counts.meeting++;
    }
  };
  const today = emptyCounts(); acc({ s: todayStart, e: todayEnd }, today);
  const week = emptyCounts();  acc({ s: weekStart,  e: weekEnd  }, week);
  const month = emptyCounts(); acc({ s: monthStart, e: monthEnd }, month);

  const placementTarget = kgi?.placement_target ?? null;
  const plan = placementTarget && conv ? planFromTarget(placementTarget, conv, monthKey(now)) : null;

  return {
    available: true,
    today, week, month,
    monthPlacedTotal,
    plan, placementTarget,
    conversion: conv,
  };
}
