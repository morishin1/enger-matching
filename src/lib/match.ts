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

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/[.．・]/g, "");

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

function salaryFit(job: Job, c: Candidate): number {
  const jMax = job.salary_max ?? job.salary_min;
  const cMin = c.salary_min ?? c.salary_max;
  if (jMax == null || cMin == null) return 0.5; // 不明
  if (cMin <= jMax) {
    // 予算内。希望が予算ぴったり〜下回るほど高評価
    const cMax = c.salary_max ?? cMin;
    return cMax <= jMax ? 1 : 0.75;
  }
  // 希望が予算超過。超過幅が小さければ部分点
  return cMin <= jMax * 1.1 ? 0.4 : 0.1;
}

export function scoreMatch(job: Job, c: Candidate): MatchResult {
  const jobSkills = (job.skills ?? []).map(norm);
  const candSet = new Set((c.skills ?? []).map(norm));
  const origJobSkills = job.skills ?? [];

  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  origJobSkills.forEach((s, i) => {
    if (candSet.has(jobSkills[i])) matchedSkills.push(s);
    else missingSkills.push(s);
  });
  const skillPct = jobSkills.length ? matchedSkills.length / jobSkills.length : (c.skills?.length ? 0.3 : 0);

  const salary = salaryFit(job, c);
  const jg = roleGroup(job.role_label);
  const cg = roleGroup(c.title);
  const roleHit = jg && cg && jg === cg;
  const remote = remoteFit(job.remote_type, c.remote_pref);

  const score = Math.round(skillPct * 60 + salary * 20 + (roleHit ? 10 : 0) + remote * 10);

  const reasons: string[] = [];
  if (matchedSkills.length) reasons.push(`必須スキル ${matchedSkills.length}/${jobSkills.length} 一致 ✓`);
  if (missingSkills.length && jobSkills.length) reasons.push(`不足: ${missingSkills.slice(0, 3).join("・")} △`);
  if (salary >= 1) reasons.push("希望単価が予算内 ✓");
  else if (salary <= 0.2) reasons.push("希望単価が予算超過 ✗");
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
