// 案件 × 人材 マッチングスコアリング (高精度・多軸)
//   skill 60 / salary 20 / role 10 / remote 10 = 100点
// スキル一致を主軸に、希望単価・職種・リモート条件の適合で補正する。

export type Job = {
  job_no?: number; id?: string; title: string; role_label?: string | null;
  skills?: string[] | null; salary_min?: number | null; salary_max?: number | null;
  remote_type?: string | null;
};
export type Candidate = {
  candidate_no?: number; id?: string; name: string; title?: string | null;
  skills?: string[] | null; salary_min?: number | null; salary_max?: number | null;
  remote_pref?: string | null; status?: string | null; exp?: string | null; rate?: string | null;
};

export type MatchResult = { score: number; matchedSkills: string[]; missingSkills: string[]; reasons: string[] };

// スキル正規化は正典辞書（skills.ts）に集約。役職テキストの素正規化のみローカルに持つ。
import { canon, normToken as norm } from "./skills";
export { canon };

/** 2つのスキル配列の一致スキル（candidate側の元表記で返す）。 */
export function overlapSkills(jobSkills?: string[] | null, candSkills?: string[] | null): string[] {
  const js = new Set((jobSkills ?? []).map(canon));
  return (candSkills ?? []).filter((s) => js.has(canon(s)));
}

// 職種カテゴリ判定用キーワード
const ROLE_GROUPS: [string, string[]][] = [
  ["frontend", ["フロント", "front", "react", "vue", "ui"]],
  ["backend", ["バックエンド", "backend", "サーバ", "api", "java", "go", "php", "python", "ruby"]],
  ["infra", ["インフラ", "infra", "sre", "クラウド", "cloud", "aws", "azure", "ネットワーク"]],
  ["data", ["データ", "data", "snowflake", "dbt", "分析", "ai", "ml", "機械学習"]],
  ["mobile", ["モバイル", "mobile", "ios", "android", "swift", "kotlin", "flutter"]],
  ["pm", ["pm", "pmo", "pjm", "プロジェクト", "マネージ", "ディレク"]],
  ["fullstack", ["フルスタック", "fullstack"]],
];
function roleGroup(text: string | null | undefined): string | null {
  const t = norm(text ?? "");
  if (!t) return null;
  for (const [g, kws] of ROLE_GROUPS) if (kws.some((k) => t.includes(norm(k)))) return g;
  return null;
}

function remoteFit(jobRemote: string | null | undefined, candPref: string | null | undefined): number {
  const cp = candPref ?? "";
  const wantsFull = /フル/.test(cp);
  const wantsRemote = /リモート|在宅/.test(cp);
  const onsiteOk = /出社|常駐|可/.test(cp);
  if (jobRemote === "full_remote") return wantsRemote || wantsFull ? 1 : onsiteOk ? 0.6 : 0.4;
  if (jobRemote === "partial_remote") return wantsRemote || onsiteOk ? 1 : 0.6;
  if (jobRemote === "onsite") return onsiteOk || !wantsFull ? 0.8 : 0.3;
  return 0.6;
}

// 希望単価レンジ（数値・万円）。salary_min/max が無い人材は rate 文字列("70〜90万"等)から推定。
const rateNums = (rate?: string | null): number[] => (rate?.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0 && n < 1000);
function candRange(c: Candidate): { min: number | null; max: number | null } {
  let min = c.salary_min ?? null;
  let max = c.salary_max ?? null;
  if (min == null || max == null) {
    const ns = rateNums(c.rate);
    if (ns.length) { if (min == null) min = Math.min(...ns); if (max == null) max = Math.max(...ns); }
  }
  return { min, max };
}

// 単価適合と「予算超過幅(万円)」を返す。
//   超過幅 ≤ 10万 … 調整可能 / 10〜20万 … 調整困難 / 20万超 … ミスマッチ（調整不能）
function salaryGap(job: Job, c: Candidate): { fit: number; overage: number | null } {
  const jMax = job.salary_max ?? job.salary_min;
  const { min: cMin, max: cMax } = candRange(c);
  if (jMax == null || cMin == null) return { fit: 0.5, overage: null }; // 不明
  if (cMin <= jMax) {
    // 予算内。希望上限も予算内なら満点、上限のみ超過なら微減
    return { fit: (cMax ?? cMin) <= jMax ? 1 : 0.85, overage: 0 };
  }
  const over = cMin - jMax; // 予算超過幅（万円）
  if (over <= 10) return { fit: 0.55, overage: over };  // 10万以内＝調整余地あり
  if (over <= 20) return { fit: 0.25, overage: over };  // 調整困難
  return { fit: 0.08, overage: over };                  // 40万差などは実質ミスマッチ
}

export function scoreMatch(job: Job, c: Candidate): MatchResult {
  const jobSkills = (job.skills ?? []).map(canon);
  const candSet = new Set((c.skills ?? []).map(canon));
  const origJobSkills = job.skills ?? [];

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  origJobSkills.forEach((s, i) => {
    if (candSet.has(jobSkills[i])) matchedSkills.push(s);
    else missingSkills.push(s);
  });
  const skillPct = jobSkills.length ? matchedSkills.length / jobSkills.length : (c.skills?.length ? 0.3 : 0);

  const { fit: salary, overage } = salaryGap(job, c);
  const jg = roleGroup(job.role_label);
  const cg = roleGroup(c.title);
  const roleHit = jg && cg && jg === cg;
  const remote = remoteFit(job.remote_type, c.remote_pref);

  let score = Math.round(skillPct * 60 + salary * 20 + (roleHit ? 10 : 0) + remote * 10);
  // 単価ギャップが大きいと現場では調整できずミスマッチになる。スキル満点でも上位に出さないよう上限を被せる。
  //   超過 10〜20万 → 最大60点 / 20万超(=40万差など) → 最大40点
  if (overage != null && overage > 10) score = Math.min(score, overage > 20 ? 40 : 60);

  const reasons: string[] = [];
  if (matchedSkills.length) reasons.push(`必須スキル ${matchedSkills.length}/${jobSkills.length} 一致 ✓`);
  if (missingSkills.length && jobSkills.length) reasons.push(`不足: ${missingSkills.slice(0, 3).join("・")} △`);
  if (overage != null && overage > 20) reasons.push(`単価が予算より約${overage}万円高く調整困難 ✗`);
  else if (overage != null && overage > 10) reasons.push(`単価が予算より約${overage}万円高い（要交渉）△`);
  else if (salary >= 1) reasons.push("希望単価が予算内 ✓");
  if (roleHit) reasons.push("職種カテゴリ一致 ✓");
  if (remote >= 0.9) reasons.push("リモート条件 適合 ✓");
  if (/即アサイン|即日/.test(c.status ?? "")) reasons.push("即アサイン可 ✓");

  return { score: Math.min(100, score), matchedSkills, missingSkills, reasons };
}

/** 候補配列を job に対してスコアリングし降順に並べて返す */
export function rankCandidates(job: Job, candidates: Candidate[], limit = 30) {
  return candidates
    .map((c) => ({ candidate: c, ...scoreMatch(job, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 案件配列を 1 人材に対してスコアリングし降順に並べて返す（人材→案件の逆マッチング） */
export function rankJobs(candidate: Candidate, jobs: Job[], limit = 30) {
  return jobs
    .map((j) => ({ job: j, ...scoreMatch(j, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
