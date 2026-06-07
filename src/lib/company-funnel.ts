// 企業ごとの提案管理ファネルを集計（狙うべき企業の根拠データ）。
//   集計指標：
//     - proposals      : 提案件数
//     - met            : 面談到達数（旧/新ステージ両対応）
//     - won            : 稼働化数
//     - lost           : 失注/見送り
//     - meetRate       : 面談化率
//     - winRate        : 稼働化率
//     - avgRate        : 平均単価（万円）
//     - avgCloseDays   : 平均クロージング日数（created_at → 稼働確定）
//     - lastProposedAt : 最終提案日
//     - topReasons     : 失注理由TOP3
//   ※ 過去の旧ステージ名（提案済/返信待ち/提案中/面談調整/クロージング中/面談合格）も互換でカウント。

import { engerAdmin, engerClient, dbConfigured } from "./supabase";

export type CompanyFunnel = {
  company: string;
  proposals: number;
  met: number;
  won: number;
  lost: number;
  meetRate: number;        // %
  winRate: number;         // %
  avgRate: number | null;  // 万円
  avgCloseDays: number | null;
  lastProposedAt: string | null;
  topReasons: { reason: string; n: number }[];
};

const MET_STAGES = new Set(["面談", "合格", "面談調整", "クロージング中", "面談合格", "稼働", "稼働決定"]);
const WON_STAGES = new Set(["合格", "面談合格", "稼働", "稼働決定"]);
const LOST_STAGES = new Set(["失注", "見送り"]);

const parseManYen = (rate?: string | number | null): number => {
  if (rate == null) return 0;
  if (typeof rate === "number") return rate >= 10000 ? Math.round(rate / 10000) : Math.round(rate);
  const m = String(rate).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (/万/.test(rate)) return Math.round(n);
  if (n >= 10000) n = n / 10000;
  return Math.round(n);
};

/** 全企業の提案ファネルを集計（直近12ヶ月）。 */
export async function loadCompanyFunnels(limit = 1000): Promise<Map<string, CompanyFunnel>> {
  const out = new Map<string, CompanyFunnel>();
  if (!dbConfigured) return out;
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  const since = new Date(Date.now() - 365 * 86400000).toISOString();
  try {
    const r: any = await sb.from("proposals")
      .select("company, stage, rate, lost_reason, created_at, stage_updated_at")
      .gte("created_at", since).limit(5000);
    const rows = (r.data ?? []) as any[];
    type Acc = { proposals: number; met: number; won: number; lost: number; rates: number[]; closeDays: number[]; lastAt: number; reasons: Map<string, number> };
    const tmp = new Map<string, Acc>();
    for (const p of rows) {
      const co = (p.company ?? "").trim();
      if (!co) continue;
      const e: Acc = tmp.get(co) ?? { proposals: 0, met: 0, won: 0, lost: 0, rates: [], closeDays: [], lastAt: 0, reasons: new Map<string, number>() };
      e.proposals++;
      const stage = String(p.stage ?? "");
      if (MET_STAGES.has(stage)) e.met++;
      if (WON_STAGES.has(stage)) {
        e.won++;
        // 平均クロージング日数
        const c = new Date(p.created_at || 0).getTime();
        const s = new Date(p.stage_updated_at || p.created_at || 0).getTime();
        if (c && s && s >= c) e.closeDays.push(Math.max(0, Math.round((s - c) / 86400000)));
      }
      if (LOST_STAGES.has(stage)) {
        e.lost++;
        const reason = (p.lost_reason ?? "").trim() || "（理由未入力）";
        e.reasons.set(reason, (e.reasons.get(reason) ?? 0) + 1);
      }
      const rate = parseManYen(p.rate);
      if (rate > 0) e.rates.push(rate);
      const t = new Date(p.created_at || 0).getTime();
      if (t > e.lastAt) e.lastAt = t;
      tmp.set(co, e);
    }
    for (const [company, e] of tmp.entries()) {
      const avgRate = e.rates.length ? Math.round(e.rates.reduce((a, b) => a + b, 0) / e.rates.length) : null;
      const avgCloseDays = e.closeDays.length ? Math.round(e.closeDays.reduce((a, b) => a + b, 0) / e.closeDays.length) : null;
      const meetRate = e.proposals > 0 ? Math.round((e.met / e.proposals) * 100) : 0;
      const winRate = e.proposals > 0 ? Math.round((e.won / e.proposals) * 100) : 0;
      const topReasons = [...e.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, n]) => ({ reason, n }));
      out.set(company, {
        company, proposals: e.proposals, met: e.met, won: e.won, lost: e.lost,
        meetRate, winRate, avgRate, avgCloseDays,
        lastProposedAt: e.lastAt ? new Date(e.lastAt).toISOString() : null,
        topReasons,
      });
    }
  } catch { /* ignore */ }
  return out;
}

/** 企業の案件スキル分布（上位N件）。 */
export async function loadCompanyTopSkills(limit = 1000): Promise<Map<string, { skill: string; n: number }[]>> {
  const out = new Map<string, { skill: string; n: number }[]>();
  if (!dbConfigured) return out;
  let sb: ReturnType<typeof engerClient>;
  try { sb = engerAdmin(); } catch { sb = engerClient(); }
  try {
    const r: any = await sb.from("jobs").select("client_name, skills").not("client_name", "is", null).limit(5000);
    const tmp = new Map<string, Map<string, number>>();
    for (const j of (r.data ?? []) as any[]) {
      const co = (j.client_name ?? "").trim();
      if (!co) continue;
      const m = tmp.get(co) ?? new Map<string, number>();
      for (const s of (j.skills ?? []) as string[]) {
        if (!s) continue;
        m.set(s, (m.get(s) ?? 0) + 1);
      }
      tmp.set(co, m);
    }
    for (const [co, m] of tmp.entries()) {
      const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([skill, n]) => ({ skill, n }));
      out.set(co, top);
    }
  } catch { /* ignore */ }
  return out;
}
