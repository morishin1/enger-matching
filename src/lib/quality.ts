// データ品質ゲート / リード分類 / KPI母数のロジック（クライアント・サーバ共用の純関数）

const DAY = 86400000;
const daysAgo = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY) : 99999);

const LOST_STAGES = ["見送り", "失注"];
// 「接触できた」とみなす架電進捗
const CONTACTED_CALLER = ["電話済み", "LINE確認中", "メール確認中", "返信あり"];
// 接触後とみなすステージ（面談以降は確実に接触済み）
const CONTACTED_STAGES = ["面談調整", "クロージング中", "面談合格", "稼働", "稼働決定"];

export type Prop = {
  id?: string; stage?: string | null; caller_status?: string | null; created_at?: string | null;
  score?: number | null; ai_match?: number | null; company?: string | null; job_title?: string | null;
  disqualified?: boolean | null;
};

/** その提案は相手と接触できたか。 */
export function isContacted(p: Prop): boolean {
  if (p.stage && CONTACTED_STAGES.includes(p.stage)) return true;
  return !!(p.caller_status && CONTACTED_CALLER.includes(p.caller_status));
}
export const isLost = (p: Prop) => !!(p.stage && LOST_STAGES.includes(p.stage));
/** 接触前失注（=そもそも有効でないリード）。 */
export const isPreContactLost = (p: Prop) => isLost(p) && !isContacted(p);
/** 接触後失注（営業として向き合った上での失注）。 */
export const isPostContactLost = (p: Prop) => isLost(p) && isContacted(p);

export type QualityRule = { id?: string; kind: string; label: string; enabled: boolean; threshold?: number | null };

/**
 * ルールに該当する提案IDと理由を返す（disqualified を立てる対象）。
 * 既に失注/見送り・既存disqualifiedは対象外（進行中のものを除外して母数を締める用途）。
 */
export function matchRules(proposals: Prop[], rules: QualityRule[]): { id: string; reason: string }[] {
  const out = new Map<string, string>();
  const active = proposals.filter((p) => !isLost(p) && !p.disqualified && p.id);

  for (const r of rules.filter((x) => x.enabled)) {
    if (r.kind === "no_reply") {
      const th = Number(r.threshold ?? 7);
      for (const p of active) {
        if (!isContacted(p) && daysAgo(p.created_at) >= th) out.set(p.id!, r.label);
      }
    } else if (r.kind === "low_potential") {
      const th = Number(r.threshold ?? 40);
      for (const p of active) {
        const sc = Number(p.ai_match ?? p.score ?? 0) || 0;
        if (sc > 0 && sc < th) { if (!out.has(p.id!)) out.set(p.id!, r.label); }
      }
    } else if (r.kind === "duplicate") {
      const seen = new Set<string>();
      // 古い順に見て、2件目以降を重複として除外
      const sorted = [...active].sort((a, b) => (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1);
      for (const p of sorted) {
        const key = `${(p.company ?? "").trim()}|${(p.job_title ?? "").trim()}`;
        if (!key.replace("|", "")) continue;
        if (seen.has(key)) { if (!out.has(p.id!)) out.set(p.id!, r.label); }
        else seen.add(key);
      }
    }
  }
  return [...out.entries()].map(([id, reason]) => ({ id, reason }));
}

export type LeadKpi = {
  total: number;          // 全提案
  preLost: number;        // 接触前失注(母数外)
  ngExcluded: number;     // NG除外(disqualified, 接触前失注と重複しない分)
  valid: number;          // 有効リード = total - preLost - ngExcluded
  postLost: number;       // 接触後失注
  postLostRate: number;   // 接触後失注率 = postLost / valid (%)
};

/** リード品質KPI（接触前失注・NGを母数から除外）。 */
export function leadKpi(proposals: Prop[]): LeadKpi {
  const total = proposals.length;
  const preLost = proposals.filter(isPreContactLost).length;
  const ngExcluded = proposals.filter((p) => p.disqualified && !isPreContactLost(p)).length;
  const valid = Math.max(0, total - preLost - ngExcluded);
  const postLost = proposals.filter((p) => isPostContactLost(p) && !p.disqualified).length;
  const postLostRate = valid ? Math.round((postLost / valid) * 100) : 0;
  return { total, preLost, ngExcluded, valid, postLost, postLostRate };
}
