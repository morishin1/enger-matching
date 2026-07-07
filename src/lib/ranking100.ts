// マッチング自動ランキング（ランキング100 ／ おすすめの組み合わせ TOP50）。
//
//   抽出条件は「マッチング自動ランキング条件定義書」に準拠する（絶対条件・すべて満たすペアのみ）：
//     Step1: 全案件 × 全人材の組み合わせを生成（同一ペアの重複なし）
//     Step2: 除外フィルタ（絶対条件）
//       #1 所属      … 「不明」「未設定」「二社下以降」の人材は除外
//       #2 スキルタグ … タグが2つ未満（0/1個）の案件は除外
//       #3 リモート   … 案件はフルリモートのみ／人材はフルリモ・一部リモ希望のみ（空欄・不明は除外）
//       #4 国籍       … 「日本国籍」以外（空欄・不明含む）の人材は除外
//       #5 年齢       … 55歳以上は除外（「50代」等の年代のみ表記で55歳以上を含み得る場合も安全側で除外）
//       #6 年齢制限   … 案件の年齢上限/下限を人材年代が外れるペアは除外（人材年齢不明はスキップ）
//       #7 単価       … 案件単価上限 − 人材希望単価下限 ≧ 7万円（どちらか不明は安全側で除外）
//       #8 商流       … 「〜社員まで」の案件・商流「不明」の案件は除外。互換マトリクスで OK のみ
//       ＋ スキルシート … リンクが無い人材は除外
//       ＋ LINE由来     … LINEマークの付く案件・人材（LINE登録/LINE経由）は除外
//       ＋ フリーランス … ENGERフリーランス由来（Eマーク）の人材は除外
//       ＋ 提案済み     … 一度提案したペア（提案ボード登録済み）は除外
//     Step3: ランキング＝総合マッチスコア（scoreMatch）の高い順（点数順・1位〜。要望対応）。
//       同点は 一致スキル数 → 単価差（案件上限−人材下限）→ 注力案件 → 新しさ → 案件番号
//       （定義書 8-1 のタイブレークを採用。一致数そのものは表示列とタイブレークで担保）。
//
//   計算量対策：案件は新しい順500件・人材は新しい順3000件に限定し、軽量なフィールド判定＋
//   Set 照合を通過したペアのみ scoreMatch で精査。5分キャッシュ（unstable_cache・タグ付き）。
//   提案するとタグ経由で即時に再計算され、提案済みペアがランキングから消える。

import { unstable_cache } from "next/cache";
import { engerClient, dbConfigured } from "./supabase";
import { scoreMatch, canon, candRange, parseJobAgeLimit, candAgeRange, type Job, type Candidate } from "./match";
import { expandSkillSet } from "./skills";
import { classifyCandNationality } from "./nationality";
import {
  classifyJobFlow, classifyCandFlow, inferJobMaxDepth, inferCandDepth, toFlowDepth,
  flowMatrixCompat, type JobFlowCategory, type CandFlowCategory,
} from "./flow";
import { resolveSkillSheetUrl } from "./proposal-mail";
import { getLineOriginIds, getFreelanceCandidateIds } from "./line-origin";

export type DimStatus = { pct: number; known: boolean };

export type RankedPair = {
  rank: number;
  skillPct: number;           // 0-100（必須スキル一致率）
  matchedCount: number;       // 一致した必須スキル数
  jobSkillCount: number;      // 案件の必須スキル数（分母）
  score: number;              // 総合マッチスコア 0-100（ランキングの主キー）
  baseScore: number;          // ボーナス除外の基礎スコア（5次元のみ）
  bonus: number;              // 別枠ボーナス（マージン/PP/業界/尚可/経験カテゴリ）
  dims: { skill: DimStatus; salary: DimStatus; remote: DimStatus; timing: DimStatus; age: DimStatus };
  matchedSkills: string[];    // 一致したスキル（人材側の元表記）
  missingSkills: string[];    // 案件で必要だが人材に無いスキル
  candExtraSkills: string[];  // 人材は持っているが案件に無いスキル
  job: {
    job_no: number; id: string | null; title: string; client_name: string | null;
    skills: string[]; salary_min: number | null; salary_max: number | null;
    role_label: string | null; remote_type: string | null; work_location: string | null;
    start_date: string | null; flow_note: string | null; detail: string | null;
    created_at: string | null;
  };
  cand: {
    candidate_no: number; id: string | null; name: string; initials: string | null; title: string | null;
    rate: string | null; company: string | null; affiliation: string | null;
    skills: string[]; exp: string | null; avail: string | null; location: string | null;
    remote_pref: string | null; age_band: string | null; nationality: string | null; note: string | null;
    created_at: string | null;
  };
  proposed: boolean;          // 定義書の除外条件により提案済みペアは表示しない＝常に false（型互換のため残置）
};

const TOP_N = 100;            // ランキング100
const AUTO_POOL = 200;        // おすすめ：期間フィルタ後に上位50を切り出せるよう多めに返す
const RATE_MARGIN_MIN = 7;    // 定義書#7：案件単価上限 − 人材希望単価下限 ≧ 7万円
const JOB_FETCH_LIMIT = 500;
const CAND_FETCH_LIMIT = 3000;
// scoreMatch（重い精査）に掛けるペア数の上限。軽量キー（一致数）で並べてから先頭だけ精査する。
const SCORE_POOL = 3000;

// ── 取得（列フォールバック付き） ─────────────────────────────────────────
//   accept_flow_depth / flow_depth / skill_sheet_url は各マイグレーション適用後のみ存在。
//   未マイグレ環境でも全体が落ちないよう、拡張SELECT → 失敗時は基本SELECT の順で試す。

const JOB_COLS_BASE = "id, job_no, title, client_name, skills, salary_min, salary_max, remote_type, rank, is_focus, detail, flow_note, role_label, work_location, start_date, created_at";
const JOB_COLS_RICH = `${JOB_COLS_BASE}, accept_flow_depth`;
const CAND_COLS_BASE = "id, candidate_no, name, initials, title, skills, rate, salary_min, salary_max, remote_pref, affiliation, source_company, company, age_band, nationality, exp, avail, location, note, created_at";
const CAND_COLS_RICH = `${CAND_COLS_BASE}, flow_depth, skill_sheet_url`;

async function fetchJobsForRanking(sb: ReturnType<typeof engerClient>): Promise<any[]> {
  for (const cols of [JOB_COLS_RICH, JOB_COLS_BASE]) {
    let r: any = await sb.from("jobs").select(cols).eq("is_published", true).is("deleted_at", null).eq("is_closed", false).order("job_no", { ascending: false }).limit(JOB_FETCH_LIMIT);
    if (r.error) r = await sb.from("jobs").select(cols).eq("is_published", true).is("deleted_at", null).order("job_no", { ascending: false }).limit(JOB_FETCH_LIMIT);
    if (r.error) r = await sb.from("jobs").select(cols).eq("is_published", true).order("job_no", { ascending: false }).limit(JOB_FETCH_LIMIT);
    if (!r.error) return r.data ?? [];
  }
  return [];
}

async function fetchCandsForRanking(sb: ReturnType<typeof engerClient>): Promise<any[]> {
  for (const cols of [CAND_COLS_RICH, CAND_COLS_BASE]) {
    let r: any = await sb.from("candidates").select(cols).is("deleted_at", null).eq("is_closed", false).order("candidate_no", { ascending: false }).limit(CAND_FETCH_LIMIT);
    if (r.error) r = await sb.from("candidates").select(cols).is("deleted_at", null).order("candidate_no", { ascending: false }).limit(CAND_FETCH_LIMIT);
    if (r.error) r = await sb.from("candidates").select(cols).order("candidate_no", { ascending: false }).limit(CAND_FETCH_LIMIT);
    if (!r.error) return r.data ?? [];
  }
  return [];
}

// ── 定義書フィルタ（案件側・人材側・ペア）── 絶対条件・不明は安全側（除外）に倒す ──

/** 案件の受入商流カテゴリ（手動深さ → flow_note 正規化 → 本文推定 の順で解決）。 */
function jobFlowCategory(j: any): JobFlowCategory {
  const manual = toFlowDepth(j.accept_flow_depth);
  if (manual != null) return manual === 0 ? "jp_to_self" : manual === 1 ? "jp_to_1" : "jp_to_2";
  const byText = classifyJobFlow(j.flow_note);
  if (byText !== "unknown") return byText;
  const d = inferJobMaxDepth({ flow_note: j.flow_note, detail: j.detail, title: j.title });
  return d == null ? "unknown" : d === 0 ? "jp_to_self" : d === 1 ? "jp_to_1" : "jp_to_2";
}

/** 人材の所属カテゴリ（手動深さ → affiliation 正規化 → 本文推定 の順で解決）。 */
function candFlowCategory(c: any): CandFlowCategory {
  const manual = toFlowDepth(c.flow_depth);
  if (manual != null) return manual === 0 ? "self_emp" : manual === 1 ? "vendor1_emp" : "vendor2plus";
  const byText = classifyCandFlow(c.affiliation);
  if (byText !== "unknown") return byText;
  const d = inferCandDepth({ affiliation: c.affiliation, note: c.note, company: c.company });
  return d == null ? "unknown" : d === 0 ? "self_emp" : d === 1 ? "vendor1_emp" : "vendor2plus";
}

// 「〜社員まで」系の案件は雇用形態の厳密判定ができないため一律除外（定義書#8・5章）。
const SEISHAIN_JOB_CATS: ReadonlySet<JobFlowCategory> = new Set(["jp_to_self_seishain", "jp_to_1_seishain", "jp_to_2_seishain"]);

/** 定義書#6 の下限（"30代以上" / "35歳以上" 等）。上限は match.ts の parseJobAgeLimit（#328準拠）。
 *   安全側（除外側）：人材の年代の下端が下限に届かないペアを除外する。 */
function parseJobAgeFloor(j: any): { ageFloor: number | null; decadeFloor: number | null } {
  const text = [j.title, j.role_label, j.flow_note, j.detail].filter(Boolean).join(" ");
  let ageFloor: number | null = null;
  let decadeFloor: number | null = null;
  const a = text.match(/([1-9][0-9])\s*[歳才]\s*(?:以上|以降)/);
  if (a) ageFloor = Number(a[1]);
  const d = text.match(/([1-9]0)\s*代\s*(?:以上|以降)/);
  if (d) decadeFloor = Number(d[1]);
  return { ageFloor, decadeFloor };
}

type JobGate = { cat: JobFlowCategory; jMax: number; ageCap: number | null; decadeCap: number | null; ageFloor: number | null; decadeFloor: number | null };
/** 案件側の絶対条件（#2 スキルタグ数 / #3 フルリモート / #8 商流 / #7 単価上限の存在）。 */
function jobGate(j: any): JobGate | null {
  if (!Array.isArray(j.skills) || j.skills.length < 2) return null;          // #2
  if (j.remote_type !== "full_remote") return null;                          // #3（案件側）
  const cat = jobFlowCategory(j);
  if (cat === "unknown") return null;                                        // #8 不明 → 除外（安全側）
  if (SEISHAIN_JOB_CATS.has(cat)) return null;                               // #8 「〜社員まで」 → 除外
  const jMax = (j.salary_max ?? j.salary_min) ?? null;                       // #7 の基準（上限優先）
  if (jMax == null) return null;                                             //   単価不明 → 安全側で除外
  const { ageCap, decadeCap } = parseJobAgeLimit(j as Job);
  const { ageFloor, decadeFloor } = parseJobAgeFloor(j);
  return { cat, jMax, ageCap, decadeCap, ageFloor, decadeFloor };
}

type CandGate = { cat: CandFlowCategory; cMin: number; ageRange: { decade: number; hi: number } | null };
/** 人材側の絶対条件（#1 所属 / #3 リモート希望 / #4 国籍 / #5 55歳 / スキルシート / 単価下限の存在）。 */
function candGate(c: any): CandGate | null {
  const cat = candFlowCategory(c);
  if (cat === "unknown" || cat === "vendor2plus") return null;               // #1 不明・未設定・二社下以降
  const cp = String(c.remote_pref ?? "").trim();
  const wantsRemote = cp === "full_remote" || cp === "partial_remote" || /リモート|在宅/.test(cp);
  if (!wantsRemote) return null;                                             // #3（人材側・空欄不明も除外）
  if (classifyCandNationality(c.nationality) !== "japan") return null;       // #4（空欄・不明も除外）
  const ageRange = candAgeRange(c as Candidate);                             // #5：年代上端が55歳以上なら除外
  if (ageRange && ageRange.hi >= 55) return null;                            //   （「50代」のみ等は安全側で除外）
  if (!resolveSkillSheetUrl(c)) return null;                                 // スキルシートリンク必須
  const cMin = candRange(c as Candidate).min;                                // #7 の基準（下限）
  if (cMin == null) return null;                                             //   不明 → 安全側で除外
  return { cat, cMin, ageRange };
}

/** ペアの絶対条件（#7 単価7万 / #8 商流互換 / #6 年齢制限突合）。 */
function pairGate(jg: JobGate, cg: CandGate): boolean {
  if (jg.jMax - cg.cMin < RATE_MARGIN_MIN) return false;                     // #7
  if (flowMatrixCompat(jg.cat, cg.cat) !== "ok") return false;               // #8（貴社まで→自社所属のみ 等）
  const ar = cg.ageRange;                                                    // #6（人材年齢不明はスキップ）
  if (ar) {
    if (jg.ageCap != null && ar.hi > jg.ageCap) return false;                //   上限（歳）：年代上端で安全側
    if (jg.decadeCap != null && ar.decade > jg.decadeCap) return false;      //   上限（年代）
    if (jg.ageFloor != null && ar.decade < Math.floor(jg.ageFloor / 10) * 10) return false; // 下限（歳）
    if (jg.decadeFloor != null && ar.decade < jg.decadeFloor) return false;  //   下限（年代）
  }
  return true;
}

// ── 共通コア：定義書フィルタ → スコア精査（点数順） ───────────────────────

function freshnessBonus(createdAt?: string | null): number {
  if (!createdAt) return 0;
  const days = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (isNaN(days)) return 0;
  if (days <= 7) return 1;
  if (days <= 30) return 0.6;
  if (days <= 60) return 0.3;
  return 0;
}

const normPersonName = (s?: string | null): string => String(s ?? "").toLowerCase().replace(/[\s　.．・,，]/g, "");

type ScoredHit = {
  job: any; cand: any; pct: number; margin: number; focus: number; fresh: number;
  score: number; baseScore: number; bonus: number; dims: RankedPair["dims"];
  matchedSkills: string[]; missingSkills: string[]; candExtraSkills: string[];
  matchedCount: number; jobSkillCount: number;
};

/** 提案済みペア（job_id×candidate_id）の集合。定義書の追加条件によりランキングから除外する。 */
async function fetchProposedPairs(sb: ReturnType<typeof engerClient>): Promise<Set<string>> {
  const proposedPairs = new Set<string>();
  try {
    const { data } = await sb.from("proposals").select("job_id, candidate_id").limit(20000);
    for (const p of (data ?? []) as any[]) if (p.job_id && p.candidate_id) proposedPairs.add(`${p.job_id}|${p.candidate_id}`);
  } catch { /* proposals 未整備でも続行 */ }
  return proposedPairs;
}

/** 定義書フィルタを満たすペアを抽出し、scoreMatch で採点して「点数順」に並べて返す。 */
async function buildRankedHits(): Promise<{ hits: ScoredHit[]; jobsScanned: number; candsScanned: number; pairsHit: number }> {
  const sb = engerClient();
  const [jobsAll, candsAll, lineIds, flIds, proposedPairs] = await Promise.all([
    fetchJobsForRanking(sb),
    fetchCandsForRanking(sb),
    getLineOriginIds(),          // LINE由来の案件/人材（fail-soft：取れなければ空）
    getFreelanceCandidateIds(),  // ENGERフリーランス由来の人材（fail-soft）
    fetchProposedPairs(sb),      // 提案済みペア
  ]);
  const lineJobIds = new Set(lineIds.jobIds);
  const lineCandIds = new Set(lineIds.candidateIds);
  const flCandIds = new Set(flIds);

  // 案件側・人材側の絶対条件を先に適用（ペア総当たりの前に母集団を絞る）
  const jobs = jobsAll
    .filter((j: any) => !(j.id && lineJobIds.has(String(j.id))))             // LINE由来の案件は除外
    .map((j: any) => ({ j, g: jobGate(j) }))
    .filter((x): x is { j: any; g: JobGate } => !!x.g);
  const cands = candsAll
    .filter((c: any) => !(c.id && (lineCandIds.has(String(c.id)) || flCandIds.has(String(c.id))))) // LINE/フリーランス由来の人材は除外
    .filter((c: any) => Array.isArray(c.skills) && c.skills.length > 0)
    .map((c: any) => ({ c, g: candGate(c), set: expandSkillSet(c.skills as string[]) }))
    .filter((x): x is { c: any; g: CandGate; set: Set<string> } => !!x.g);

  // ペア条件 ＋ スキル一致（1件以上）で候補ペアを抽出。提案済みペアはここで除外。
  type Hit = { job: any; cand: any; count: number; margin: number; pct: number };
  const raw: Hit[] = [];
  for (const { j, g: jg } of jobs) {
    const jskills: string[] = (j.skills as string[]).map(canon);
    const need = jskills.length;
    for (const { c, g: cg, set } of cands) {
      if (j.id && c.id && proposedPairs.has(`${j.id}|${c.id}`)) continue;    // 提案済み → 除外
      if (!pairGate(jg, cg)) continue;
      let m = 0; for (const s of jskills) if (set.has(s)) m++;
      if (m < 1) continue;  // 一致スキル0のペアは対象外（ランキングの意味を持たないため）
      raw.push({ job: j, cand: c, count: m, margin: jg.jMax - cg.cMin, pct: m / need });
    }
  }
  const pairsHit = raw.length;

  // 軽量キー（一致数 → 一致率 → 単価差）で並べ、上位だけ scoreMatch で精査
  raw.sort((a, b) => (b.count - a.count) || (b.pct - a.pct) || (b.margin - a.margin) || (b.job.job_no - a.job.job_no));
  const pool = raw.slice(0, SCORE_POOL);

  const hits: ScoredHit[] = [];
  for (const h of pool) {
    const m = scoreMatch(h.job as Job, h.cand as Candidate);
    if (m.excluded) continue; // ハード除外（充足/終了・国籍NG・出社必須NG）
    const jset = new Set<string>((h.job.skills as string[]).map(canon));
    const extras = (h.cand.skills as string[]).filter((s) => !jset.has(canon(s)));
    hits.push({
      job: h.job, cand: h.cand, pct: h.pct, margin: h.margin,
      focus: h.job.is_focus ? 1 : 0,
      fresh: (freshnessBonus(h.job.created_at) + freshnessBonus(h.cand.created_at)) * 5,
      score: m.score, baseScore: m.baseScore, bonus: m.bonus, dims: m.dims,
      matchedSkills: m.matchedSkills, missingSkills: m.missingSkills, candExtraSkills: extras,
      matchedCount: m.matchedSkills.length, jobSkillCount: (h.job.skills as string[]).length,
    });
  }

  // 点数順（総合スコア降順）。同点は 一致数 → 単価差 → 注力案件 → 新しさ → 案件番号（定義書 8-1）。
  hits.sort((a, b) =>
    (b.score - a.score)
    || (b.matchedCount - a.matchedCount)
    || (b.margin - a.margin)
    || (b.focus - a.focus)
    || (b.fresh - a.fresh)
    || (b.job.job_no - a.job.job_no),
  );

  return { hits, jobsScanned: jobs.length, candsScanned: cands.length, pairsHit };
}

function toRankedPair(h: ScoredHit, i: number): RankedPair {
  return {
    rank: i + 1,
    skillPct: Math.round(h.pct * 100),
    matchedCount: h.matchedCount,
    jobSkillCount: h.jobSkillCount,
    score: h.score,
    baseScore: h.baseScore,
    bonus: h.bonus,
    dims: h.dims,
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
      created_at: h.job.created_at ?? null,
    },
    cand: {
      candidate_no: h.cand.candidate_no, id: h.cand.id ?? null, name: h.cand.name ?? "",
      initials: h.cand.initials ?? null, title: h.cand.title ?? null,
      rate: h.cand.rate ?? null, company: (h.cand.source_company || h.cand.company) ?? null,
      affiliation: h.cand.affiliation ?? null, skills: h.cand.skills ?? [],
      exp: h.cand.exp ?? null, avail: h.cand.avail ?? null, location: h.cand.location ?? null,
      remote_pref: h.cand.remote_pref ?? null, age_band: h.cand.age_band ?? null,
      nationality: h.cand.nationality ?? null, note: h.cand.note ?? null,
      created_at: h.cand.created_at ?? null,
    },
    proposed: false, // 提案済みペアは抽出段階で除外済み
  };
}

// ── ランキング100 ────────────────────────────────────────────────────────

async function fetchRanking100(): Promise<{ rows: RankedPair[]; jobsScanned: number; candsScanned: number; pairsHit: number }> {
  if (!dbConfigured) return { rows: [], jobsScanned: 0, candsScanned: 0, pairsHit: 0 };
  const { hits, jobsScanned, candsScanned, pairsHit } = await buildRankedHits();
  const rows = hits.slice(0, TOP_N).map((h, i) => toRankedPair(h, i));
  return { rows, jobsScanned, candsScanned, pairsHit };
}

// 5分キャッシュ＋タグ。提案の記録（recordProposal 等）が revalidateTag で即時無効化する。
export const getRanking100 = unstable_cache(fetchRanking100, ["ranking-100"], { revalidate: 300, tags: ["ranking-100"] });

// ── 自動マッチング（おすすめの組み合わせ）─────────────────────────────────
//   ランキング100と同じ定義書フィルタ・点数順を使い、
//   ・同じ人材は1回だけ（重複排除）
//   ・同じ案件も1回だけ（多様な組み合わせを出す）
//   で上位を返す。期間フィルタ後に上位50を切り出せるよう、多め（AUTO_POOL）に返す。

async function fetchAutoMatchTop(): Promise<{ rows: RankedPair[]; jobsScanned: number; candsScanned: number; pairsHit: number }> {
  if (!dbConfigured) return { rows: [], jobsScanned: 0, candsScanned: 0, pairsHit: 0 };
  const { hits, jobsScanned, candsScanned, pairsHit } = await buildRankedHits();

  // 重複排除：同じ人材・同じ案件は最良の1組だけ採用（点数順なので先勝ち＝最高スコア）。
  const usedPerson = new Set<string>();
  const usedJob = new Set<number>();
  const picked: ScoredHit[] = [];
  for (const h of hits) {
    if (picked.length >= AUTO_POOL) break;
    const pkey = normPersonName(h.cand.name) + "|" + normPersonName(h.cand.source_company || h.cand.company);
    if (usedPerson.has(pkey)) continue;
    if (h.job.job_no != null && usedJob.has(h.job.job_no)) continue;
    usedPerson.add(pkey);
    if (h.job.job_no != null) usedJob.add(h.job.job_no);
    picked.push(h);
  }

  const rows = picked.map((h, i) => toRankedPair(h, i));
  return { rows, jobsScanned, candsScanned, pairsHit };
}

export const getAutoMatchTop = unstable_cache(fetchAutoMatchTop, ["auto-match-top"], { revalidate: 300, tags: ["auto-match-top"] });
