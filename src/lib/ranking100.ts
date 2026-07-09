// マッチング自動ランキング（ランキング100 ／ おすすめの組み合わせ TOP50）。
//
//   組み合わせを「高 / 中 / 低」の3ランクに分けて表示する（要望）。
//   ・まず「確定した致命的NG」を全ランク共通で除外する（提案不可・二社下以降・55歳以上・
//     国籍NG案件×外国籍・充足/終了・LINE/フリーランス由来・提案済み・スキル一致0・単価逆ざや）。
//   ・残ったペアについて、定義書の各条件が「確定OK」か「不明（要確認）」かで“要確認事項”を数え、
//       要確認 0件 → 高（確実に提案できる。定義書の絶対条件を確定データで全て満たす）
//       要確認 1〜2件 → 中（数点を確認すれば提案できる可能性が高い）
//       要確認 3件以上 → 低（参考。要確認事項が多い）
//     に振り分ける。これにより「高」だけでなく「他に良さそうな組み合わせ（中・低）」も出せる。
//
//   要確認になり得る条件（＝不明・空欄・非理想のとき1件としてカウント）：
//     国籍（日本国籍が未確定）／ リモート（案件フルリモ＋人材リモ希望が理想でない）／
//     所属（人材の所属区分が不明）／ 商流（案件の受入商流が不明）／ スキルシート（リンク無）／
//     単価（案件上限・人材下限のどちらか不明、またはマージン7万円未満）
//
//   ランキングは各ランク内で総合マッチスコア（scoreMatch）の高い順。
//   並びは ランク（高→中→低）→ スコア → 一致数 → 単価差 → 注力 → 新しさ → 案件番号。
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
export type MatchTier = "high" | "mid" | "low";

export type RankedPair = {
  rank: number;
  tier: MatchTier;            // 高 / 中 / 低
  concerns: string[];         // 要確認事項（中・低の根拠。高は空）
  skillPct: number;           // 0-100（必須スキル一致率）
  matchedCount: number;       // 一致した必須スキル数
  jobSkillCount: number;      // 案件の必須スキル数（分母）
  score: number;              // 総合マッチスコア 0-100（ランク内の並び順の主キー）
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
    detail_note: string | null; // #344：手入力の案件詳細（人材側メールに最優先で挿入）
    created_at: string | null;
  };
  cand: {
    candidate_no: number; id: string | null; name: string; initials: string | null; title: string | null;
    rate: string | null; company: string | null; affiliation: string | null;
    skills: string[]; exp: string | null; avail: string | null; location: string | null;
    remote_pref: string | null; age_band: string | null; nationality: string | null; note: string | null;
    created_at: string | null;
  };
  proposed: boolean;          // 提案済みペアは抽出段階で除外済み＝常に false（型互換のため残置）
};

const TOP_N = 100;            // ランキング100
const AUTO_POOL = 200;        // おすすめ：期間フィルタ後に上位50を切り出せるよう多めに返す
const RATE_MARGIN_MIN = 7;    // 定義書#7：案件単価上限 − 人材希望単価下限 ≧ 7万円
const SKILL_FLOOR = 1 / 3;    // スキル一致率の下限（これ未満は低ランクでも出さない＝ノイズ抑制）
const JOB_FETCH_LIMIT = 500;
const CAND_FETCH_LIMIT = 5000;
// scoreMatch（重い精査）に掛けるペア数の上限。軽量キー（一致率）で並べてから先頭だけ精査する。
const SCORE_POOL = 3500;

// ── 担当者（登録担当 operator）フィルタ ─────────────────────────────────
//   マッチングの負荷軽減のため、選択した担当者の人材だけを対象に計算する（要望）。
//   ・all=true … 担当者で絞らず全人材（従来挙動）。「全員」選択時。
//   ・operators … candidates.operator が一致する人材だけ（インデックス使用で軽量）。
//   ・includeUnassigned … operator 未設定（過去取込データ等）の人材も含める。
export type AssigneeFilter = { all: boolean; operators: string[]; includeUnassigned: boolean };

const ALL_TOKEN = "__all__";
const UNASSIGNED_TOKEN = "__unassigned__";

/** URL の ?assignee= を AssigneeFilter に解釈。未選択（空）は null（＝計算しない＝遅延ロード）。 */
export function parseAssigneeParam(param?: string | null): AssigneeFilter | null {
  const raw = (param ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.includes(ALL_TOKEN)) return { all: true, operators: [], includeUnassigned: false };
  const includeUnassigned = parts.includes(UNASSIGNED_TOKEN);
  const operators = Array.from(new Set(parts.filter((p) => p !== UNASSIGNED_TOKEN))).sort();
  if (operators.length === 0 && !includeUnassigned) return null;
  return { all: false, operators, includeUnassigned };
}

/** キャッシュキーを安定させるため正規化（operators はソート済み）。 */
function normalizeAssignee(f: AssigneeFilter): AssigneeFilter {
  return f.all
    ? { all: true, operators: [], includeUnassigned: false }
    : { all: false, operators: [...f.operators].sort(), includeUnassigned: f.includeUnassigned };
}

// ── 取得（列フォールバック付き） ─────────────────────────────────────────
//   accept_flow_depth / flow_depth / skill_sheet_url は各マイグレーション適用後のみ存在。
//   未マイグレ環境でも全体が落ちないよう、拡張SELECT → 失敗時は基本SELECT の順で試す。

const JOB_COLS_BASE = "id, job_no, title, client_name, skills, salary_min, salary_max, remote_type, rank, is_focus, detail, flow_note, role_label, work_location, start_date, created_at";
// detail_note＝手入力の案件詳細（#344：送信文プレビューの人材側メールに最優先で挿入）。未整備環境は BASE にフォールバック。
const JOB_COLS_RICH = `${JOB_COLS_BASE}, accept_flow_depth, detail_note`;
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

// 人材取得の operator 絞り込みモード。in=指定担当 / null=未割当 / all=絞らず全件。
type CandOpMode = { kind: "all" } | { kind: "in"; ops: string[] } | { kind: "null" };
const applyOpMode = (q: any, mode: CandOpMode) =>
  mode.kind === "in" ? q.in("operator", mode.ops) : mode.kind === "null" ? q.is("operator", null) : q;

/** 1モードぶんの人材を取得（列フォールバック＋deleted/closed フォールバック付き）。 */
async function loadCandsByMode(sb: ReturnType<typeof engerClient>, mode: CandOpMode): Promise<{ data: any[]; opColMissing: boolean }> {
  for (const cols of [CAND_COLS_RICH, CAND_COLS_BASE]) {
    let r: any = await applyOpMode(sb.from("candidates").select(cols).is("deleted_at", null).eq("is_closed", false), mode).order("candidate_no", { ascending: false }).limit(CAND_FETCH_LIMIT);
    if (r.error) r = await applyOpMode(sb.from("candidates").select(cols).is("deleted_at", null), mode).order("candidate_no", { ascending: false }).limit(CAND_FETCH_LIMIT);
    if (r.error) r = await applyOpMode(sb.from("candidates").select(cols), mode).order("candidate_no", { ascending: false }).limit(CAND_FETCH_LIMIT);
    if (!r.error) return { data: r.data ?? [], opColMissing: false };
    // operator 列自体が無い環境（未マイグレ）は担当フィルタ不可 → 呼び出し側で全件にフォールバック
    if (mode.kind !== "all" && /operator|column/i.test(r.error.message ?? "")) return { data: [], opColMissing: true };
  }
  return { data: [], opColMissing: false };
}

/** 担当者フィルタに応じて人材を取得（operator でDB段階から絞り、計算量を軽減）。 */
async function fetchCandsForRanking(sb: ReturnType<typeof engerClient>, filter: AssigneeFilter): Promise<any[]> {
  const modes: CandOpMode[] = filter.all
    ? [{ kind: "all" }]
    : [
        ...(filter.operators.length ? [{ kind: "in", ops: filter.operators } as CandOpMode] : []),
        ...(filter.includeUnassigned ? [{ kind: "null" } as CandOpMode] : []),
      ];
  const out = new Map<string, any>();
  let opColMissing = false;
  for (const mode of modes) {
    const r = await loadCandsByMode(sb, mode);
    if (r.opColMissing) { opColMissing = true; continue; }
    for (const row of r.data) out.set(String(row.id ?? `x${out.size}`), row);
  }
  // operator 列が無い環境では担当で絞れないため、安全側で全件にフォールバック（フィルタ無効）。
  if (opColMissing && out.size === 0) {
    const r = await loadCandsByMode(sb, { kind: "all" });
    for (const row of r.data) out.set(String(row.id ?? `x${out.size}`), row);
  }
  return [...out.values()];
}

// ── 担当者（operator）別の人材件数。セレクタの表示・「全員/未割当」件数に使う（軽量：operator列のみ）。
export type OperatorCounts = { agents: { name: string; count: number }[]; unassigned: number; total: number };

async function fetchOperatorCounts(): Promise<OperatorCounts> {
  if (!dbConfigured) return { agents: [], unassigned: 0, total: 0 };
  const sb = engerClient();
  let r: any = await sb.from("candidates").select("operator").is("deleted_at", null).eq("is_closed", false).limit(20000);
  if (r.error) r = await sb.from("candidates").select("operator").is("deleted_at", null).limit(20000);
  if (r.error) r = await sb.from("candidates").select("operator").limit(20000);
  if (r.error) return { agents: [], unassigned: 0, total: 0 }; // operator 列なし等 → 空（UI側は「全員」のみ）
  const map = new Map<string, number>();
  let unassigned = 0; let total = 0;
  for (const row of (r.data ?? []) as any[]) {
    total++;
    const op = String(row.operator ?? "").trim();
    if (!op) { unassigned++; continue; }
    map.set(op, (map.get(op) ?? 0) + 1);
  }
  const agents = [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, "ja"));
  return { agents, unassigned, total };
}

// 5分キャッシュ。担当者セレクタ用の軽量集計（operator 列のみスキャン）。
export const getOperatorCounts = unstable_cache(fetchOperatorCounts, ["operator-counts"], { revalidate: 300, tags: ["operator-counts"] });

// ── カテゴリ解決 ─────────────────────────────────────────────────────────

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

/** 定義書#6 の下限（"30代以上" / "35歳以上" 等）。上限は match.ts の parseJobAgeLimit（#328準拠）。 */
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

// ── 案件側・人材側の情報（致命的NGなら null＝除外。それ以外は要確認判定に使う素材を返す） ──

type JobInfo = {
  cat: JobFlowCategory; jMax: number | null; ageCap: number | null; decadeCap: number | null;
  ageFloor: number | null; decadeFloor: number | null; fullRemote: boolean;
};
/** 案件：致命的NG（スキルタグ2未満・「〜社員まで」）は除外。リモート/商流/単価不明は要確認へ回す。 */
function jobInfo(j: any): JobInfo | null {
  if (!Array.isArray(j.skills) || j.skills.length < 2) return null;   // #2（致命的：ランキングの意味を成さない）
  const cat = jobFlowCategory(j);
  if (SEISHAIN_JOB_CATS.has(cat)) return null;                        // #8「〜社員まで」（雇用形態判定不可）
  const { ageCap, decadeCap } = parseJobAgeLimit(j as Job);
  const { ageFloor, decadeFloor } = parseJobAgeFloor(j);
  return {
    cat, jMax: (j.salary_max ?? j.salary_min) ?? null,
    ageCap, decadeCap, ageFloor, decadeFloor,
    fullRemote: j.remote_type === "full_remote",
  };
}

type CandInfo = {
  cat: CandFlowCategory; cMin: number | null; ageRange: { decade: number; hi: number } | null;
  natJapan: boolean; remoteWants: boolean; hasSkillSheet: boolean;
};
/** 人材：致命的NG（確定「二社下以降」・55歳以上）は除外。国籍/リモート/スキルシート不明は要確認へ回す。 */
function candInfo(c: any): CandInfo | null {
  const cat = candFlowCategory(c);
  if (cat === "vendor2plus") return null;                             // #1 二社下以降（確定・全ランク除外）
  const ageRange = candAgeRange(c as Candidate);
  if (ageRange && ageRange.hi >= 55) return null;                     // #5 55歳以上（全ランク除外）
  const cp = String(c.remote_pref ?? "").trim();
  return {
    cat, cMin: candRange(c as Candidate).min, ageRange,
    natJapan: classifyCandNationality(c.nationality) === "japan",
    remoteWants: cp === "full_remote" || cp === "partial_remote" || /リモート|在宅/.test(cp),
    hasSkillSheet: !!resolveSkillSheetUrl(c),
  };
}

/** ペアの致命的NG（年齢制限超過・単価逆ざや）。true=残す / false=除外。 */
function pairAllowed(jg: JobInfo, cg: CandInfo): boolean {
  // #6 年齢制限（人材年齢不明はスキップ）
  const ar = cg.ageRange;
  if (ar) {
    if (jg.ageCap != null && ar.hi > jg.ageCap) return false;
    if (jg.decadeCap != null && ar.decade > jg.decadeCap) return false;
    if (jg.ageFloor != null && ar.decade < Math.floor(jg.ageFloor / 10) * 10) return false;
    if (jg.decadeFloor != null && ar.decade < jg.decadeFloor) return false;
  }
  // 単価の逆ざや（人材の希望下限が案件上限を超える＝赤字）は全ランク除外。7万円未満は要確認（表示可）。
  if (jg.jMax != null && cg.cMin != null && cg.cMin > jg.jMax) return false;
  return true;
}

/** 要確認事項（不明・非理想の条件を列挙）。空なら「高」。件数でランクを決める。 */
function concernsOf(jg: JobInfo, cg: CandInfo, matrix: ReturnType<typeof flowMatrixCompat>): string[] {
  const c: string[] = [];
  if (!cg.natJapan) c.push("国籍要確認（日本国籍が未確定）");
  if (!(jg.fullRemote && cg.remoteWants)) c.push("リモート要確認（フルリモート×リモート希望が理想）");
  if (cg.cat === "unknown") c.push("所属要確認（人材の所属区分が不明）");
  if (jg.cat === "unknown" || matrix === "unknown") c.push("商流要確認（案件の受入商流が不明）");
  if (!cg.hasSkillSheet) c.push("スキルシート未登録");
  if (jg.jMax == null || cg.cMin == null) c.push("単価要確認（案件上限か人材下限が不明）");
  else if (jg.jMax - cg.cMin < RATE_MARGIN_MIN) c.push(`単価マージン薄（差 ${jg.jMax - cg.cMin}万円 < 7万円）`);
  return c;
}

function tierOf(concernCount: number): MatchTier {
  if (concernCount === 0) return "high";
  if (concernCount <= 2) return "mid";
  return "low";
}
const TIER_RANK: Record<MatchTier, number> = { high: 0, mid: 1, low: 2 };

// ── 共通コア：致命的NG除外 → 要確認判定でランク付け → ランク→点数順 ──────────

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
  tier: MatchTier; concerns: string[];
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

/** #345①：手動で「表示させない」にしたペア（job_no×candidate_no）の集合。期間無関係に恒久除外する。 */
async function fetchHiddenPairs(sb: ReturnType<typeof engerClient>): Promise<Set<string>> {
  const hidden = new Set<string>();
  try {
    const { data } = await sb.from("hidden_pairs").select("job_no, candidate_no").limit(50000);
    for (const p of (data ?? []) as any[]) if (p.job_no != null && p.candidate_no != null) hidden.add(`${p.job_no}|${p.candidate_no}`);
  } catch { /* hidden_pairs 未整備でも続行 */ }
  return hidden;
}

/** 致命的NGを除外し、要確認事項でランク付けして「ランク→点数順」に並べて返す。
 *   filter で人材を担当者（operator）で絞ることで計算量を軽減する。 */
async function buildRankedHits(filter: AssigneeFilter): Promise<{ hits: ScoredHit[]; jobsScanned: number; candsScanned: number; pairsHit: number }> {
  const sb = engerClient();
  const [jobsAll, candsAll, lineIds, flIds, proposedPairs, hiddenPairs] = await Promise.all([
    fetchJobsForRanking(sb),
    fetchCandsForRanking(sb, filter),
    getLineOriginIds(),          // LINE由来の案件/人材（fail-soft：取れなければ空）
    getFreelanceCandidateIds(),  // ENGERフリーランス由来の人材（fail-soft）
    fetchProposedPairs(sb),      // 提案済みペア
    fetchHiddenPairs(sb),        // #345①：手動で非表示にしたペア
  ]);
  const lineJobIds = new Set(lineIds.jobIds);
  const lineCandIds = new Set(lineIds.candidateIds);
  const flCandIds = new Set(flIds);

  // 案件側・人材側の致命的NGを先に除外（ペア総当たりの前に母集団を絞る）
  const jobs = jobsAll
    .filter((j: any) => !(j.id && lineJobIds.has(String(j.id))))             // LINE由来の案件は除外
    .map((j: any) => ({ j, g: jobInfo(j) }))
    .filter((x): x is { j: any; g: JobInfo } => !!x.g);
  const cands = candsAll
    .filter((c: any) => !(c.id && (lineCandIds.has(String(c.id)) || flCandIds.has(String(c.id))))) // LINE/フリーランス由来の人材は除外
    .filter((c: any) => Array.isArray(c.skills) && c.skills.length > 0)
    .map((c: any) => ({ c, g: candInfo(c), set: expandSkillSet(c.skills as string[]) }))
    .filter((x): x is { c: any; g: CandInfo; set: Set<string> } => !!x.g);

  // ペアの致命的NG（年齢制限・逆ざや・商流確定NG・提案済み・スキル一致率）を除外して候補抽出。
  type Hit = { job: any; cand: any; count: number; margin: number; pct: number; matrix: ReturnType<typeof flowMatrixCompat> };
  const raw: Hit[] = [];
  for (const { j, g: jg } of jobs) {
    const jskills: string[] = (j.skills as string[]).map(canon);
    const need = jskills.length;
    for (const { c, g: cg, set } of cands) {
      if (j.id && c.id && proposedPairs.has(`${j.id}|${c.id}`)) continue;    // 提案済み → 除外
      if (j.job_no != null && c.candidate_no != null && hiddenPairs.has(`${j.job_no}|${c.candidate_no}`)) continue; // #345①：手動非表示 → 除外
      if (!pairAllowed(jg, cg)) continue;                                    // 年齢制限・逆ざや → 除外
      const matrix = flowMatrixCompat(jg.cat, cg.cat);
      if (matrix === "ng") continue;                                        // #8 商流の確定NG（提案不可）→ 除外
      let m = 0; for (const s of jskills) if (set.has(s)) m++;
      const pct = m / need;
      if (pct < SKILL_FLOOR) continue;                                       // スキル一致率が低すぎる → 除外
      const margin = (jg.jMax != null && cg.cMin != null) ? jg.jMax - cg.cMin : 0;
      raw.push({ job: j, cand: c, count: m, margin, pct, matrix });
    }
  }
  const pairsHit = raw.length;

  // 軽量キー（一致率）で並べ、上位だけ scoreMatch で精査（重い計算の件数を抑える）
  raw.sort((a, b) => (b.pct - a.pct) || (b.count - a.count) || (b.margin - a.margin) || (b.job.job_no - a.job.job_no));
  const pool = raw.slice(0, SCORE_POOL);

  const hits: ScoredHit[] = [];
  for (const h of pool) {
    const m = scoreMatch(h.job as Job, h.cand as Candidate);
    if (m.excluded) continue; // ハード除外（充足/終了・国籍NG案件×外国籍・出社必須×リモート限定）
    const jg = jobInfo(h.job)!; const cg = candInfo(h.cand)!;
    const concerns = concernsOf(jg, cg, h.matrix);
    const jset = new Set<string>((h.job.skills as string[]).map(canon));
    const extras = (h.cand.skills as string[]).filter((s) => !jset.has(canon(s)));
    hits.push({
      job: h.job, cand: h.cand, pct: h.pct, margin: h.margin,
      focus: h.job.is_focus ? 1 : 0,
      fresh: (freshnessBonus(h.job.created_at) + freshnessBonus(h.cand.created_at)) * 5,
      tier: tierOf(concerns.length), concerns,
      score: m.score, baseScore: m.baseScore, bonus: m.bonus, dims: m.dims,
      matchedSkills: m.matchedSkills, missingSkills: m.missingSkills, candExtraSkills: extras,
      matchedCount: m.matchedSkills.length, jobSkillCount: (h.job.skills as string[]).length,
    });
  }

  // ランク（高→中→低）→ 総合スコア → 一致数 → 単価差 → 注力 → 新しさ → 案件番号。
  hits.sort((a, b) =>
    (TIER_RANK[a.tier] - TIER_RANK[b.tier])
    || (b.score - a.score)
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
    tier: h.tier,
    concerns: h.concerns,
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
      detail_note: h.job.detail_note ?? null,
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
  // ランキング100は全人材対象（担当者フィルタなし）。
  const { hits, jobsScanned, candsScanned, pairsHit } = await buildRankedHits({ all: true, operators: [], includeUnassigned: false });
  const rows = hits.slice(0, TOP_N).map((h, i) => toRankedPair(h, i));
  return { rows, jobsScanned, candsScanned, pairsHit };
}

// 5分キャッシュ＋タグ。提案の記録（recordProposal 等）が revalidateTag で即時無効化する。
export const getRanking100 = unstable_cache(fetchRanking100, ["ranking-100"], { revalidate: 300, tags: ["ranking-100"] });

// ── 自動マッチング（おすすめの組み合わせ）─────────────────────────────────
//   ランキング100と同じランク付け・並びを使い、
//   ・同じ人材は1回だけ（重複排除）
//   ・同じ案件も1回だけ（多様な組み合わせを出す）
//   で上位を返す。期間フィルタ後に上位50を切り出せるよう、多め（AUTO_POOL）に返す。

async function fetchAutoMatchTop(filter: AssigneeFilter): Promise<{ rows: RankedPair[]; jobsScanned: number; candsScanned: number; pairsHit: number }> {
  if (!dbConfigured) return { rows: [], jobsScanned: 0, candsScanned: 0, pairsHit: 0 };
  const { hits, jobsScanned, candsScanned, pairsHit } = await buildRankedHits(filter);

  // 重複排除：同じ人材・同じ案件は最良の1組だけ採用（ランク→点数順なので先勝ち＝最良）。
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

// 5分キャッシュ＋タグ。担当者フィルタ（正規化済み）ごとにキャッシュされる。
//   提案の記録（recordProposal 等）が revalidateTag("auto-match-top") で全variantを即時無効化する。
const _cachedAutoMatchTopFor = unstable_cache(
  (filter: AssigneeFilter) => fetchAutoMatchTop(filter),
  ["auto-match-top-for"],
  { revalidate: 300, tags: ["auto-match-top"] },
);

/** 担当者フィルタ指定でおすすめTOP候補を取得。未選択（計算しない）はページ側でガードする。 */
export function getAutoMatchTopFor(filter: AssigneeFilter) {
  return _cachedAutoMatchTopFor(normalizeAssignee(filter));
}
