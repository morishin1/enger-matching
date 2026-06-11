// 案件 × 人材 マッチングスコアリング（決定論的）
//   合計100点：スキル80 + 単価8 + 勤務形態5 + 稼働時期4 + 年齢3
//   ボーナス：マージン理想(5〜10万) +2 / PPプロパー +1 / 業界経験(推定) +1
//   ハードフィルター：国籍要件 NG → 除外（score=0, excluded=true）
//   注意事項：12軸を 🔴重要 / 🟡注意 / 🟢参考 の3段階で返す（採点と分離）
//   判定: 75+ 提案推奨 / 60+ 条件付き提案推奨 / 50+ 条件付き提案検討 / <50 提案不可

export type Job = {
  job_no?: number; id?: string; title: string; role_label?: string | null;
  skills?: string[] | null; salary_min?: number | null; salary_max?: number | null;
  remote_type?: string | null; start_date?: string | null;
  client_name?: string | null; detail?: string | null; flow_note?: string | null;
  accept_flow_depth?: number | null;  // 受入商流の上限（0=PPのみ/1=一社先/2=二社先/null=不明）
  work_location?: string | null;
  // 鮮度・充足の判定用（任意。マッチング画面が付与）
  status?: string | null;             // 案件ステータス（募集中/募集終了 等）
  created_at?: string | null;         // 取込日（鮮度の基準フォールバック）
  last_confirmed_at?: string | null;  // 最終在否確認日（あれば鮮度の基準に優先）
  is_filled?: boolean;                // 稼働決定済み（枠が埋まった）→ proposals から付与
  // 送達不能：bounce_records にこの案件の宛先(contact_email)が存在する場合に付与。
  contact_email?: string | null;
  is_undeliverable?: boolean;         // contact_email がバウンスしている
  undeliverable_count?: number;       // 観測回数（表示用）
};
export type Candidate = {
  candidate_no?: number; id?: string; name: string; title?: string | null;
  skills?: string[] | null; salary_min?: number | null; salary_max?: number | null;
  remote_pref?: string | null; status?: string | null; exp?: string | null; rate?: string | null; rate_num?: number | null;
  avail?: string | null; affiliation?: string | null; age_band?: string | null; nationality?: string | null;
  flow_depth?: number | null;         // 階層深さ（0=PP/1=一社下/2=二社下以降/null=不明）
  note?: string | null; company?: string | null; location?: string | null;
  created_at?: string | null; // 登録日（新着優先のランキングに使用）
};

// 候補の鮮度しきい値（日）。これ以内に登録された人材を「新着」として優先表示する。
export const CAND_FRESH_DAYS = 5;
export function candidateAgeDays(c: Candidate, nowMs = Date.now()): number | null {
  if (!c.created_at) return null;
  const t = new Date(c.created_at).getTime();
  if (isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

export type Note = { level: "red" | "yellow" | "green"; text: string };
export type Verdict = "提案推奨" | "条件付き提案推奨" | "条件付き提案検討" | "提案不可";
export type MatchResult = {
  score: number;                          // 0-100（ボーナス込み・上限100）
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];                      // 互換用：notes.text の配列
  notes: Note[];                          // 3段階の注意事項
  verdict: Verdict;
  excluded?: boolean;                     // 国籍NGなどでハード除外
  flow?: { compat: FlowCompat; jobCat: string; candCat: string; jobLabel: string; candLabel: string };  // 商流（バッジ表示用・新マトリックス）
  breakdown: { skill: number; salary: number; remote: number; timing: number; age: number; bonus: number };
};

// スキル正規化は正典辞書（skills.ts）に集約。
import { canon, normToken as norm } from "./skills";
import { flowMatchMatrix, JOB_FLOW_LABEL, CAND_FLOW_LABEL, type FlowCompat } from "./flow";
export { canon };

/** 2つのスキル配列の一致スキル（candidate側の元表記で返す）。 */
export function overlapSkills(jobSkills?: string[] | null, candSkills?: string[] | null): string[] {
  const js = new Set((jobSkills ?? []).map(canon));
  return (candSkills ?? []).filter((s) => js.has(canon(s)));
}

// ---- 勤務形態（旧 remote） ----
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

// ---- 単価 / マージン ----
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
/** 単価適合(0-1) + 予算超過幅(万円) + マージン(万円・予算上限-希望下限) */
function salaryGap(job: Job, c: Candidate): { fit: number; overage: number | null; margin: number | null } {
  const jMax = job.salary_max ?? job.salary_min;
  const { min: cMin, max: cMax } = candRange(c);
  if (jMax == null || cMin == null) return { fit: 0.7, overage: null, margin: null };
  if (cMin <= jMax) {
    const margin = jMax - cMin; // ＋なら余裕（理想5〜10万）
    return { fit: (cMax ?? cMin) <= jMax ? 1 : 0.85, overage: 0, margin };
  }
  const over = cMin - jMax;
  if (over <= 10) return { fit: 0.55, overage: over, margin: -over };
  if (over <= 20) return { fit: 0.25, overage: over, margin: -over };
  return { fit: 0.08, overage: over, margin: -over };
}

// ---- 稼働時期 ----
const MONTH_RE = /(\d{1,2})\s*月/;
function monthOfText(t?: string | null): number | null {
  if (!t) return null;
  if (/即日|直ぐ|すぐ|本日|今すぐ/.test(t)) return new Date().getMonth() + 1;
  const m = t.match(MONTH_RE); if (m) return Number(m[1]);
  if (/翌月|来月/.test(t)) { const d = new Date(); return ((d.getMonth() + 1) % 12) + 1; }
  if (/再来月/.test(t)) { const d = new Date(); return ((d.getMonth() + 2) % 12) + 1; }
  return null;
}
function monthOfDate(d?: string | null): number | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})/.exec(d); return m ? Number(m[2]) : null;
}
/** 稼働時期適合 0-1（差0=1, 差1=0.7, 差2=0.4, 差3=0.2, 4以上=0.05） */
function timingFit(job: Job, c: Candidate): { fit: number; jobM: number | null; candM: number | null } {
  const jobM = monthOfDate(job.start_date) ?? monthOfText(job.detail);
  const candM = monthOfText(c.avail) ?? monthOfText(c.status);
  if (jobM == null || candM == null) return { fit: 0.6, jobM, candM }; // 不明は中庸（採点に効きすぎない）
  const diff = Math.min(Math.abs(jobM - candM), 12 - Math.abs(jobM - candM));
  const fit = diff === 0 ? 1 : diff === 1 ? 0.7 : diff === 2 ? 0.4 : diff === 3 ? 0.2 : 0.05;
  return { fit, jobM, candM };
}

// ---- 年齢 ----
const AGE_BAND_RE = /([1-9]0)\s*代/g;
function bandsOfText(t?: string | null): number[] {
  if (!t) return [];
  const out: number[] = []; let m: RegExpExecArray | null;
  AGE_BAND_RE.lastIndex = 0;
  while ((m = AGE_BAND_RE.exec(t))) out.push(Number(m[1]));
  return out;
}
function ageOfBand(b?: string | null): number | null { const m = AGE_BAND_RE.exec(b ?? ""); AGE_BAND_RE.lastIndex = 0; return m ? Number(m[1]) : null; }
/** job.detail 内の "30代まで" "20〜40代" "若手" を解釈し、候補の age_band と適合度を返す。 */
function ageFit(job: Job, c: Candidate): { fit: number; mismatch: boolean; jobRange: string | null } {
  const candAge = ageOfBand(c.age_band);
  const text = `${job.detail ?? ""} ${job.title ?? ""}`;
  const bands = bandsOfText(text);
  const youngOnly = /若手|ヤング/.test(text);
  const seniorOnly = /シニア|ベテラン/.test(text);
  if (candAge == null) {
    if (bands.length === 0 && !youngOnly && !seniorOnly) return { fit: 0.7, mismatch: false, jobRange: null };
    return { fit: 0.5, mismatch: false, jobRange: bands.length ? `${bands.join("〜")}代` : (youngOnly ? "若手" : "シニア") };
  }
  if (bands.length === 0 && !youngOnly && !seniorOnly) return { fit: 1, mismatch: false, jobRange: null };
  if (youngOnly && candAge >= 50) return { fit: 0.1, mismatch: true, jobRange: "若手" };
  if (seniorOnly && candAge < 30) return { fit: 0.3, mismatch: true, jobRange: "シニア" };
  if (bands.length) {
    const lo = Math.min(...bands), hi = Math.max(...bands);
    if (candAge >= lo && candAge <= hi) return { fit: 1, mismatch: false, jobRange: `${lo}〜${hi}代` };
    const diff = candAge < lo ? lo - candAge : candAge - hi;
    return { fit: diff <= 10 ? 0.4 : 0.1, mismatch: diff > 10, jobRange: `${lo}〜${hi}代` };
  }
  return { fit: 0.7, mismatch: false, jobRange: null };
}

// ---- 国籍ハードフィルター ----
/** 案件文中に「日本国籍/日本人のみ・外国籍不可」等があり、候補が日本国籍でない場合に true。 */
function nationalityHardNg(job: Job, c: Candidate): boolean {
  const text = `${job.detail ?? ""} ${job.title ?? ""}`;
  const requiresJp = /日本国籍(のみ|限定|に?限る|必須)|日本人(のみ|限定|に?限る)|外国籍(不可|NG|お断り)|永住権(必須|必要)/i.test(text);
  if (!requiresJp) return false;
  const n = (c.nationality ?? "").trim();
  if (!n) return false; // 不明は安全側で除外しない（注意事項で警告するだけ）
  return !/日本|JP|JPN|Japan/i.test(n);
}
function nationalityWarn(job: Job, c: Candidate): boolean {
  const text = `${job.detail ?? ""} ${job.title ?? ""}`;
  const requiresJp = /日本国籍|日本人|外国籍/i.test(text);
  return requiresJp && !(c.nationality && /日本|JP|Japan/i.test(c.nationality));
}

// ---- 業界経験（推定・ボーナス＋注意事項） ----
const INDUSTRY_KWS: [string, RegExp][] = [
  ["金融", /銀行|証券|保険|金融|fintech|フィンテック|ファイナンス/i],
  ["EC・小売", /EC|eコマース|小売|物販|モール|楽天|amazon/i],
  ["医療", /医療|病院|薬局|製薬|ヘルスケア|医薬/i],
  ["官公庁", /官公庁|公共|自治体|省庁|国|政府/i],
  ["製造", /製造|メーカー|工場|生産|industrial/i],
  ["SaaS", /saas|サブスク|プラットフォーム/i],
  ["通信", /通信|キャリア|モバイル|nttdocomo|softbank|kddi/i],
  ["広告", /広告|マーケ|プロモ/i],
];
function industriesOfText(t?: string | null): string[] {
  if (!t) return []; const out: string[] = [];
  for (const [k, re] of INDUSTRY_KWS) if (re.test(t)) out.push(k);
  return out;
}
function industryMatch(job: Job, c: Candidate): { match: string[]; jobInds: string[]; candInds: string[] } {
  const jobText = `${job.client_name ?? ""} ${job.detail ?? ""} ${job.title ?? ""}`;
  const candText = `${c.exp ?? ""} ${c.note ?? ""} ${c.title ?? ""} ${c.company ?? ""}`;
  const jobInds = industriesOfText(jobText);
  const candInds = industriesOfText(candText);
  const match = jobInds.filter((g) => candInds.includes(g));
  return { match, jobInds, candInds };
}

// ---- 商流（採点なし・注意事項のみ。判定は flowMatchMatrix に集約） ----
function flowNotes(job: Job, c: Candidate, fm: ReturnType<typeof flowMatchMatrix>): Note[] {
  const notes: Note[] = [];
  const jl = JOB_FLOW_LABEL[fm.jobCat];
  const cl = CAND_FLOW_LABEL[fm.candCat];
  if (fm.compat === "ng") {
    notes.push({ level: "red", text: `商流NG：案件「${jl}」／人材「${cl}」（互換性マトリックスで不可）` });
  } else if (fm.compat === "ok") {
    notes.push({ level: "green", text: `商流OK：案件「${jl}」／人材「${cl}」` });
  } else {
    const why = fm.jobCat === "unknown" && fm.candCat === "unknown" ? "両方不明"
      : fm.jobCat === "unknown" ? "案件側の受入商流が不明"
      : "人材の所属区分が不明";
    notes.push({ level: "yellow", text: `商流要確認：${why}（案件「${jl}」／人材「${cl}」）` });
  }
  return notes;
}

// ---- 役職カテゴリ（参考） ----
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
  const t = norm(text ?? ""); if (!t) return null;
  for (const [g, kws] of ROLE_GROUPS) if (kws.some((k) => t.includes(norm(k)))) return g;
  return null;
}

function verdictOf(score: number, excluded: boolean): Verdict {
  if (excluded) return "提案不可";
  if (score >= 75) return "提案推奨";
  if (score >= 60) return "条件付き提案推奨";
  if (score >= 50) return "条件付き提案検討";
  return "提案不可";
}

// ===== 案件の鮮度・充足（古い/決まった案件を出さないための土台） ==========
// マッチングに「古い案件」「決まった案件」を混ぜるのは致命的なため、scoreMatch でも
// 最終防衛線として判定する（画面側でも除外するが、個別案件ビュー等の漏れを防ぐ）。
export const JOB_STALE_DAYS = 30; // この日数を超えたら「古い」。基準=最終確認日 or 取込日
// 明示的に終了/充足を示すステータス（手動運用での補助。主判定は is_filled）
const TERMINAL_STATUS = /(募集\s*終了|終了|決定|クロ[ー-]?ズ|停止|充足|キャンセル|中止|close|closed|filled)/i;

export type JobOpenness = { closed: boolean; closedReason: string | null; staleDays: number | null; stale: boolean };

/** 案件の「まだ提案してよいか」を判定。closed=充足/終了、stale=古い。 */
export function jobOpenness(job: Job, nowMs: number = Date.now()): JobOpenness {
  const closedByStatus = !!job.status && TERMINAL_STATUS.test(job.status);
  const closed = !!job.is_filled || closedByStatus;
  const closedReason = job.is_filled
    ? "稼働決定済み（枠が埋まっています）"
    : closedByStatus ? `案件ステータス「${job.status}」` : null;
  const baseRaw = job.last_confirmed_at || job.created_at || null;
  const staleDays = baseRaw ? Math.floor((nowMs - new Date(baseRaw).getTime()) / 86400000) : null;
  const stale = staleDays != null && staleDays > JOB_STALE_DAYS;
  return { closed, closedReason, staleDays, stale };
}

export function scoreMatch(job: Job, c: Candidate): MatchResult {
  const jobSkills = (job.skills ?? []).map(canon);
  const candSet = new Set((c.skills ?? []).map(canon));
  const origJobSkills = job.skills ?? [];
  const matchedSkills: string[] = []; const missingSkills: string[] = [];
  origJobSkills.forEach((s, i) => { if (candSet.has(jobSkills[i])) matchedSkills.push(s); else missingSkills.push(s); });
  const skillPct = jobSkills.length ? matchedSkills.length / jobSkills.length : (c.skills?.length ? 0.3 : 0);

  const { fit: salaryFit, overage, margin } = salaryGap(job, c);
  const { fit: remote } = { fit: remoteFit(job.remote_type, c.remote_pref) };
  const timing = timingFit(job, c);
  const age = ageFit(job, c);
  const ind = industryMatch(job, c);
  const ngNat = nationalityHardNg(job, c);
  const fm = flowMatchMatrix(job, c);
  const flowNg = fm.compat === "ng";

  // ---- 100点配点 ----
  const skill100 = Math.round(skillPct * 100);            // 0-100（重み80）
  const salary100 = Math.round(salaryFit * 100);          // 0-100（重み8）
  const remote100 = Math.round(remote * 100);             // 0-100（重み5）
  const timing100 = Math.round(timing.fit * 100);         // 0-100（重み4）
  const age100 = Math.round(age.fit * 100);               // 0-100（重み3）

  let weighted = skill100 * 0.80 + salary100 * 0.08 + remote100 * 0.05 + timing100 * 0.04 + age100 * 0.03;

  // ---- ボーナス ----
  let bonus = 0;
  // マージン理想：5〜10万 = +2 / 1〜4万 or 11〜15万 = +1
  if (margin != null && margin >= 5 && margin <= 10) bonus += 2;
  else if (margin != null && ((margin >= 1 && margin < 5) || (margin > 10 && margin <= 15))) bonus += 1;
  // PPプロパー優遇
  const aff = (c.affiliation ?? "").toUpperCase();
  const isPP = /PP|プロパー/i.test(c.affiliation ?? "") || aff === "PP";
  if (isPP) bonus += 1;
  // 業界経験 +1（推定なので控えめ）
  if (ind.match.length > 0) bonus += 1;

  // ---- ハードフィルター ----
  let score = Math.round(Math.min(100, weighted + bonus));
  if (ngNat) score = 0;
  // 単価大幅超過のセーフティ（旧ロジック踏襲：致命差は上限を被せる）
  if (!ngNat && overage != null && overage > 20) score = Math.min(score, 40);
  else if (!ngNat && overage != null && overage > 10) score = Math.min(score, 65);

  // ---- 案件の鮮度・充足（最優先で表示） ----
  const open = jobOpenness(job);

  // ---- 注意事項（3段階） ----
  const notes: Note[] = [];
  // 充足/終了 → 最上段に赤で明示（再提案は致命的）
  if (open.closed) notes.push({ level: "red", text: `この案件は提案できません：${open.closedReason}` });
  // 古い案件 → 在否確認を促す赤注記
  else if (open.stale) notes.push({ level: "red", text: `案件配信から約${open.staleDays}日・在否未確認。提案前に先方へ募集継続を確認してください` });
  else if (open.staleDays != null && open.staleDays > JOB_STALE_DAYS - 10) notes.push({ level: "yellow", text: `案件配信から約${open.staleDays}日（鮮度やや低下・確認推奨）` });
  // 送達不能：宛先がバウンスしている → 赤注記＋『提案推奨』への昇格抑制
  if (job.is_undeliverable) notes.push({ level: "red", text: `宛先 ${job.contact_email} は送達不能（${job.undeliverable_count ?? 1}回観測）。正しい連絡先を確認してから提案を` });

  if (ngNat) notes.push({ level: "red", text: "国籍要件NG（日本国籍が必須の案件）" });
  else if (nationalityWarn(job, c)) notes.push({ level: "yellow", text: "国籍要件に言及あり（候補の国籍を要確認）" });

  if (jobSkills.length) {
    if (matchedSkills.length === jobSkills.length) notes.push({ level: "green", text: `必須スキル ${jobSkills.length}/${jobSkills.length} 完全一致` });
    else if (skillPct >= 0.8) notes.push({ level: "green", text: `必須スキル ${matchedSkills.length}/${jobSkills.length} 一致（不足: ${missingSkills.slice(0, 3).join("・")}）` });
    else if (skillPct >= 0.5) notes.push({ level: "yellow", text: `必須スキル一部欠落 ${matchedSkills.length}/${jobSkills.length}（不足: ${missingSkills.slice(0, 3).join("・")}）` });
    else notes.push({ level: "red", text: `必須スキル不足 ${matchedSkills.length}/${jobSkills.length}（不足: ${missingSkills.slice(0, 3).join("・")}）` });
  }

  if (overage != null && overage > 20) notes.push({ level: "red", text: `単価が予算より約${overage}万円高く調整困難` });
  else if (overage != null && overage > 10) notes.push({ level: "yellow", text: `単価が予算より約${overage}万円高い（要交渉）` });
  else if (margin != null && margin >= 5 && margin <= 10) notes.push({ level: "green", text: `マージン理想圏（約${margin}万円の余裕）` });
  else if (margin != null && margin > 10) notes.push({ level: "green", text: `単価に余裕あり（約${margin}万円の余裕）` });
  else if (overage == null) notes.push({ level: "yellow", text: "単価情報が不足／要相談（交渉で調整可）" });

  if (remote >= 0.9) notes.push({ level: "green", text: "勤務形態 適合" });
  else if (remote >= 0.6) notes.push({ level: "yellow", text: "勤務形態に軽微なズレ（要確認）" });
  else notes.push({ level: "red", text: "勤務形態 ミスマッチ" });

  if (timing.jobM != null && timing.candM != null) {
    if (timing.fit >= 0.9) notes.push({ level: "green", text: `稼働時期 一致（${timing.jobM}月 / 候補${timing.candM}月〜）` });
    else if (timing.fit >= 0.4) notes.push({ level: "yellow", text: `稼働時期に差（案件${timing.jobM}月 vs 候補${timing.candM}月）` });
    else notes.push({ level: "red", text: `稼働時期 大幅差（案件${timing.jobM}月 vs 候補${timing.candM}月）` });
  } else notes.push({ level: "yellow", text: "稼働時期 情報不足" });

  if (age.mismatch) notes.push({ level: "red", text: `年齢要件ミスマッチ（案件: ${age.jobRange ?? "—"} / 候補: ${c.age_band ?? "—"}）` });
  else if (age.jobRange && age.fit >= 0.9) notes.push({ level: "green", text: `年齢要件 適合（${c.age_band ?? "—"}）` });

  // 商流（採点なし・注意事項のみ。NGは下の verdict 引き下げで提案抑止）
  for (const n of flowNotes(job, c, fm)) notes.push(n);

  // ボーナス系
  if (isPP) notes.push({ level: "green", text: "PPプロパー（+1）" });
  if (ind.match.length > 0) notes.push({ level: "green", text: `業界経験一致（${ind.match.join("・")}）` });
  else if (ind.jobInds.length > 0) notes.push({ level: "yellow", text: `案件業界: ${ind.jobInds.join("・")}（候補の業界経験は要確認）` });

  // 役職カテゴリ
  if (roleGroup(job.role_label) && roleGroup(job.role_label) === roleGroup(c.title)) notes.push({ level: "green", text: "職種カテゴリ一致" });

  if (/即アサイン|即日/.test(c.status ?? "")) notes.push({ level: "green", text: "即アサイン可" });

  // ---- 互換用 reasons ----
  const reasons = notes.map((n) => `${n.level === "red" ? "🔴" : n.level === "yellow" ? "🟡" : "🟢"} ${n.text}`);

  // 充足/終了はハード除外。古い案件・送達不能・商流NG は除外せず判定の引き下げで提案抑止する
  //   （バッジ＋提案時確認の運用に合わせ、完全ブロックは避ける）。
  const hardExcluded = ngNat || open.closed;
  let verdict = verdictOf(score, hardExcluded);
  if (!hardExcluded && (open.stale || job.is_undeliverable) && (verdict === "提案推奨" || verdict === "条件付き提案推奨")) {
    verdict = "条件付き提案検討";
  }
  if (!hardExcluded && flowNg) {
    // 商流NG は最も低い「条件付き提案検討」まで引き下げる（提案不可は出さないが推奨は剥がす）
    if (verdict === "提案推奨" || verdict === "条件付き提案推奨") verdict = "条件付き提案検討";
  }

  return {
    score,
    matchedSkills, missingSkills, reasons, notes,
    verdict,
    excluded: hardExcluded || undefined,
    flow: { compat: fm.compat, jobCat: fm.jobCat, candCat: fm.candCat, jobLabel: JOB_FLOW_LABEL[fm.jobCat], candLabel: CAND_FLOW_LABEL[fm.candCat] },
    breakdown: { skill: skill100, salary: salary100, remote: remote100, timing: timing100, age: age100, bonus },
  };
}

/** 候補配列を job に対してスコアリングし降順に並べて返す。
 *  スコア同点は「新着（candidate.created_at が新しい）」を優先し、古い人材が上位に居座らないようにする。 */
export function rankCandidates(job: Job, candidates: Candidate[], limit = 30) {
  const now = Date.now();
  const scored = candidates
    .map((c) => ({ candidate: c, ...scoreMatch(job, c) }))
    .filter((r) => !r.excluded)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同点 → 新しい登録を優先（created_at 降順）。created_at 無しは後ろへ。
      const ta = a.candidate.created_at ? new Date(a.candidate.created_at).getTime() : 0;
      const tb = b.candidate.created_at ? new Date(b.candidate.created_at).getTime() : 0;
      return tb - ta;
    });
  return collapseSamePeople(scored).slice(0, limit);
}

/** 案件配列を 1 人材に対してスコアリングし降順に並べて返す */
export function rankJobs(candidate: Candidate, jobs: Job[], limit = 30) {
  return jobs
    .map((j) => ({ job: j, ...scoreMatch(j, candidate) }))
    .filter((r) => !r.excluded)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ===== 同一人物の集約（厳格・非破壊） =====================================
// イニシャル(name)は弱いキーのため、別人を潰さないよう複合条件で「ほぼ確実に同一人物」のみ集約。
//   条件: 氏名(正規化)一致 かつ スキル8割以上一致 かつ 単価レンジ重複 かつ（所属会社 or 登録元が一致）
// DB は一切変更せず、ランキング表示上だけ1件に畳む（代表＝最上位スコアのレコード）。

const normName = (s?: string | null): string => String(s ?? "").toLowerCase().replace(/[\s　.．・,，]/g, "");

function skillOverlapRatio(a: Candidate, b: Candidate): number {
  const sa = new Set((a.skills ?? []).map(canon));
  const sb = new Set((b.skills ?? []).map(canon));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0; for (const s of sa) if (sb.has(s)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

function rateOverlap(a: Candidate, b: Candidate): boolean {
  const ra = candRange(a), rb = candRange(b);
  // どちらかが単価不明（要相談など）の場合は判定材料にせず重複扱い（他条件で担保）
  if (ra.min == null || rb.min == null) return true;
  const aMin = ra.min, aMax = ra.max ?? ra.min;
  const bMin = rb.min, bMax = rb.max ?? rb.min;
  return aMin <= bMax && bMin <= aMax;
}

function sameCompanyOrSource(a: Candidate, b: Candidate): boolean {
  const ca = normName((a as any).source_company || a.company);
  const cb = normName((b as any).source_company || b.company);
  if (ca && cb && ca === cb) return true;
  const sa = normName((a as any).source_csv);
  const sb = normName((b as any).source_csv);
  if (sa && sb && sa === sb) return true;
  // 元メール(送信元SES窓口)が一致するなら同一供給元＝同一人物の可能性が高い
  const ma = String((a as any).source_mail_url ?? "").trim();
  const mb = String((b as any).source_mail_url ?? "").trim();
  if (ma && mb && ma === mb) return true;
  return false;
}

/** 厳格判定：別人を巻き込まないよう全条件を満たすときのみ同一人物とみなす。 */
function isSamePerson(a: Candidate, b: Candidate): boolean {
  if (!a.name || !b.name) return false;
  if (normName(a.name) !== normName(b.name)) return false;
  if (skillOverlapRatio(a, b) < 0.8) return false;
  if (!rateOverlap(a, b)) return false;
  return sameCompanyOrSource(a, b);
}

export type Collapsible<T> = T & { candidate: Candidate; dupCount?: number; dupNos?: number[] };

/** スコア降順の配列から同一人物を畳み、代表(先頭=最上位)に集約件数を付与して返す。 */
function collapseSamePeople<T extends { candidate: Candidate; score: number }>(rows: T[]): Collapsible<T>[] {
  const out: Collapsible<T>[] = [];
  for (const r of rows) {
    const rep = out.find((o) => isSamePerson(o.candidate, r.candidate));
    if (rep) {
      rep.dupCount = (rep.dupCount ?? 1) + 1;
      (rep.dupNos ??= rep.candidate.candidate_no != null ? [rep.candidate.candidate_no] : []);
      if (r.candidate.candidate_no != null) rep.dupNos.push(r.candidate.candidate_no);
      // 代表に欠けている表示情報を吸収（スキルは和集合、空欄は補完）して情報量を上げる
      const merged = new Set([...(rep.candidate.skills ?? []), ...(r.candidate.skills ?? [])]);
      rep.candidate = { ...r.candidate, ...rep.candidate, skills: Array.from(merged) };
      continue;
    }
    out.push({ ...r });
  }
  return out;
}
