// ランキング100：全案件 × 全人材の組み合わせから「必須スキル一致率 75% 以上」の
// ペアだけを抽出し、一致率→総合スコア順で上位100件を返す。
//   ・案件側の skills を必須スキルとみなし、一致率 = 一致数 / 案件スキル数。
//   ・計算量を抑えるため、案件は新しい順500件・人材は新しい順3000件に限定し、
//     一致率の事前フィルタ（軽量な Set 照合）を通過したペアのみ scoreMatch で精査。
//   ・5分キャッシュ（unstable_cache）。データの取込后も最大5分で反映される。

import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";
import { scoreMatch, canon, type Job, type Candidate } from "./match";

export type RankedPair = {
  rank: number;
  skillPct: number;           // 0-100（必須スキル一致率）
  matchedCount: number;       // 一致した必須スキル数
  jobSkillCount: number;      // 案件の必須スキル数（分母）
  score: number;              // 総合マッチスコア 0-100（自動マッチングと同じ scoreMatch）
  matchedSkills: string[];    // 一致したスキル（人材側の元表記）
  missingSkills: string[];    // 案件で必要だが人材に無いスキル
  candExtraSkills: string[];  // 人材は持っているが案件に無いスキル
  job: {
    job_no: number; id: string | null; title: string; client_name: string | null;
    skills: string[]; salary_min: number | null; salary_max: number | null;
    role_label: string | null; remote_type: string | null; work_location: string | null;
    start_date: string | null; flow_note: string | null; detail: string | null;
  };
  cand: {
    candidate_no: number; id: string | null; name: string; initials: string | null; title: string | null;
    rate: string | null; company: string | null; affiliation: string | null;
    skills: string[]; exp: string | null; avail: string | null; location: string | null;
    remote_pref: string | null; age_band: string | null; nationality: string | null; note: string | null;
  };
  proposed: boolean;          // 既に提案済みのペアか
};

const MIN_PCT = 0.75;
const TOP_N = 100;

async function fetchRanking100(): Promise<{ rows: RankedPair[]; jobsScanned: number; candsScanned: number; pairsHit: number }> {
  if (!dbConfigured) return { rows: [], jobsScanned: 0, candsScanned: 0, pairsHit: 0 };
  const sb = engerClient();

  // 案件：公開・未削除・未クローズ・スキルあり。新しい順500件。
  //   ドロワーの比較表示に使う追加列（role_label/work_location/start_date）も取得。
  const jcols = "id, job_no, title, client_name, skills, salary_min, salary_max, remote_type, rank, detail, flow_note, role_label, work_location, start_date, created_at";
  let jr: any = await sb.from("jobs").select(jcols).eq("is_published", true).is("deleted_at", null).eq("is_closed", false).order("job_no", { ascending: false }).limit(500);
  if (jr.error) jr = await sb.from("jobs").select(jcols).eq("is_published", true).is("deleted_at", null).order("job_no", { ascending: false }).limit(500);
  if (jr.error) jr = await sb.from("jobs").select(jcols).eq("is_published", true).order("job_no", { ascending: false }).limit(500);
  const jobs: any[] = (jr.data ?? []).filter((j: any) => Array.isArray(j.skills) && j.skills.length > 0);

  // 人材：未削除・未クローズ・スキルあり。新しい順3000件。
  //   ドロワーの比較表示に使う追加列（exp/avail/location/note）も取得。
  const ccols = "id, candidate_no, name, initials, title, skills, rate, salary_min, salary_max, remote_pref, affiliation, source_company, company, age_band, nationality, exp, avail, location, note, created_at";
  let cr: any = await sb.from("candidates").select(ccols).is("deleted_at", null).eq("is_closed", false).order("candidate_no", { ascending: false }).limit(3000);
  if (cr.error) cr = await sb.from("candidates").select(ccols).is("deleted_at", null).order("candidate_no", { ascending: false }).limit(3000);
  if (cr.error) cr = await sb.from("candidates").select(ccols).order("candidate_no", { ascending: false }).limit(3000);
  const cands: any[] = (cr.data ?? []).filter((c: any) => Array.isArray(c.skills) && c.skills.length > 0);

  // 人材スキルを canon 化した Set を前計算
  const candPrep = cands.map((c) => ({ c, set: new Set<string>((c.skills as string[]).map(canon)) }));

  // 一致率 75% 以上のペアを軽量フィルタで抽出
  type Hit = { job: any; cand: any; pct: number };
  const hits: Hit[] = [];
  for (const j of jobs) {
    const jskills: string[] = (j.skills as string[]).map(canon);
    const need = jskills.length;
    if (need === 0) continue;
    for (const { c, set } of candPrep) {
      let m = 0;
      for (const s of jskills) if (set.has(s)) m++;
      const pct = m / need;
      if (pct >= MIN_PCT) hits.push({ job: j, cand: c, pct });
    }
  }

  // 提案済みペアの突合（job_id × candidate_id）
  const proposedPairs = new Set<string>();
  try {
    const { data } = await sb.from("proposals").select("job_id, candidate_id").limit(20000);
    for (const p of (data ?? []) as any[]) {
      if (p.job_id && p.candidate_id) proposedPairs.add(`${p.job_id}|${p.candidate_id}`);
    }
  } catch { /* proposals 未整備でも続行 */ }

  // 生き残りペアだけ総合スコアを精査。
  //   ランキングは「自動マッチングの総合スコア(score)」を主軸にする。
  //   ただし score は単一スキル案件で 100 に張り付きやすいため、
  //   同点は「一致した必須スキルの絶対数が多い順」で割る（4/4 を 1/1 より上位に）。
  //   さらに一致率 → 案件の必須スキル数（リッチさ）→ 案件番号 で安定ソート。
  const scored = hits.map((h) => {
    const m = scoreMatch(h.job as Job, h.cand as Candidate);
    const jobSkillCount = (h.job.skills as string[]).length;
    // 「人材が持っている案件外スキル」（参考表示用）：人材スキルから一致分を除いたもの。
    const jset = new Set<string>((h.job.skills as string[]).map(canon));
    const extras = (h.cand.skills as string[]).filter((s) => !jset.has(canon(s)));
    return { ...h, score: m.score, matchedSkills: m.matchedSkills, missingSkills: m.missingSkills, candExtraSkills: extras, matchedCount: m.matchedSkills.length, jobSkillCount };
  });
  scored.sort((a, b) =>
    (b.score - a.score)
    || (b.matchedCount - a.matchedCount)
    || (b.pct - a.pct)
    || (b.jobSkillCount - a.jobSkillCount)
    || (b.job.job_no - a.job.job_no),
  );

  const rows: RankedPair[] = scored.slice(0, TOP_N).map((h, i) => ({
    rank: i + 1,
    skillPct: Math.round(h.pct * 100),
    matchedCount: h.matchedCount,
    jobSkillCount: h.jobSkillCount,
    score: h.score,
    matchedSkills: h.matchedSkills,
    missingSkills: h.missingSkills,
    candExtraSkills: h.candExtraSkills,
    job: {
      job_no: h.job.job_no, id: h.job.id ?? null, title: h.job.title ?? "",
      client_name: h.job.client_name ?? null, skills: h.job.skills ?? [],
      salary_min: h.job.salary_min ?? null, salary_max: h.job.salary_max ?? null,
      role_label: h.job.role_label ?? null, remote_type: h.job.remote_type ?? null,
      work_location: h.job.work_location ?? null, start_date: h.job.start_date ?? null,
      flow_note: h.job.flow_note ?? null, detail: h.job.detail ?? null,
    },
    cand: {
      candidate_no: h.cand.candidate_no, id: h.cand.id ?? null, name: h.cand.name ?? "",
      initials: h.cand.initials ?? null, title: h.cand.title ?? null,
      rate: h.cand.rate ?? null, company: (h.cand.source_company || h.cand.company) ?? null,
      affiliation: h.cand.affiliation ?? null, skills: h.cand.skills ?? [],
      exp: h.cand.exp ?? null, avail: h.cand.avail ?? null, location: h.cand.location ?? null,
      remote_pref: h.cand.remote_pref ?? null, age_band: h.cand.age_band ?? null,
      nationality: h.cand.nationality ?? null, note: h.cand.note ?? null,
    },
    proposed: !!(h.job.id && h.cand.id && proposedPairs.has(`${h.job.id}|${h.cand.id}`)),
  }));

  return { rows, jobsScanned: jobs.length, candsScanned: cands.length, pairsHit: hits.length };
}

// 5分キャッシュ。重い総当たり計算をリクエスト毎に繰り返さない。
export const getRanking100 = unstable_cache(fetchRanking100, ["ranking-100"], { revalidate: 300 });
