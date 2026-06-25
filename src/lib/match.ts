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
  baseScore: number;                      // ボーナスを含めない基礎スコア（5次元のみ・上限100）
  bonus: number;                          // 別枠の加点（情報の確実性から付与）
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];                      // 互換用：notes.text の配列
  notes: Note[];                          // 3段階の注意事項
  verdict: Verdict;
  excluded?: boolean;                     // 国籍NGなどでハード除外
  flow?: { compat: FlowCompat; jobCat: string; candCat: string; jobLabel: string; candLabel: string };  // 商流（バッジ表示用・新マトリックス）
  breakdown: { skill: number; salary: number; remote: number; timing: number; age: number; bonus: number };
  /** 内訳ミニバー / 不明指摘などの表示用に、各次元の評価ステータスを返す */
  dims: {
    skill:  { pct: number; known: boolean };
    salary: { pct: number; known: boolean };
    remote: { pct: number; known: boolean };
    timing: { pct: number; known: boolean };
    age:    { pct: number; known: boolean };
  };
};

// スキル正規化は正典辞書（skills.ts）に集約。
import { canon, normToken as norm, skillMentionRegex, expandSkillSet, skillParents } from "./skills";
import { flowMatchMatrix, JOB_FLOW_LABEL, CAND_FLOW_LABEL, type FlowCompat } from "./flow";
import { classifyCandNationality, classifyJobNationality } from "./nationality";
export { canon };

/** 2つのスキル配列の一致スキル（candidate側の元表記で返す）。 */
export function overlapSkills(jobSkills?: string[] | null, candSkills?: string[] | null): string[] {
  const js = new Set((jobSkills ?? []).map(canon));
  // 完全一致に加え、内包（子→親：例 EC2→AWS / Spring→Java）でも一致とみなす。
  return (candSkills ?? []).filter((s) => {
    const c = canon(s);
    if (js.has(c)) return true;
    for (const p of skillParents(c)) if (js.has(p)) return true;
    return false;
  });
}

// ---- 勤務形態（旧 remote） ----
function remoteFit(jobRemote: string | null | undefined, candPref: string | null | undefined): { fit: number; known: boolean } {
  const cp = candPref ?? "";
  const wantsFull = /フル/.test(cp);
  const wantsRemote = /リモート|在宅/.test(cp);
  const onsiteOk = /出社|常駐|可/.test(cp);
  const jobKnown = jobRemote === "full_remote" || jobRemote === "partial_remote" || jobRemote === "onsite";
  const candKnown = !!cp.trim();
  if (jobRemote === "full_remote") return { fit: wantsRemote || wantsFull ? 1 : onsiteOk ? 0.6 : 0.4, known: jobKnown && candKnown };
  if (jobRemote === "partial_remote") return { fit: wantsRemote || onsiteOk ? 1 : 0.6, known: jobKnown && candKnown };
  if (jobRemote === "onsite") return { fit: onsiteOk || !wantsFull ? 0.8 : 0.3, known: jobKnown && candKnown };
  return { fit: 0.55, known: false }; // 情報不明 → 中庸
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
/** 単価適合(0-1) + 予算超過幅(万円) + マージン(万円・予算上限-希望下限) + 情報の確実性。
 *   ・known=false（不明）の場合は中庸 0.55 を返し、満点には乗らないようにする。
 *     → 「不明だから100%」を防ぎ、確実な適合だけが上位に来る。 */
function salaryGap(job: Job, c: Candidate): { fit: number; overage: number | null; margin: number | null; known: boolean } {
  const jMax = job.salary_max ?? job.salary_min;
  const { min: cMin, max: cMax } = candRange(c);
  if (jMax == null || cMin == null) return { fit: 0.55, overage: null, margin: null, known: false };
  if (cMin <= jMax) {
    const margin = jMax - cMin; // ＋なら余裕（理想5〜10万）
    return { fit: (cMax ?? cMin) <= jMax ? 1 : 0.85, overage: 0, margin, known: true };
  }
  const over = cMin - jMax;
  if (over <= 10) return { fit: 0.55, overage: over, margin: -over, known: true };
  if (over <= 20) return { fit: 0.25, overage: over, margin: -over, known: true };
  return { fit: 0.08, overage: over, margin: -over, known: true };
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
/** 稼働時期適合 0-1（差0=1, 差1=0.7, 差2=0.4, 差3=0.2, 4以上=0.05） + 情報の確実性。 */
function timingFit(job: Job, c: Candidate): { fit: number; jobM: number | null; candM: number | null; known: boolean } {
  const jobM = monthOfDate(job.start_date) ?? monthOfText(job.detail);
  const candM = monthOfText(c.avail) ?? monthOfText(c.status);
  if (jobM == null || candM == null) return { fit: 0.5, jobM, candM, known: false }; // 不明は中庸（採点に効きすぎない・100%にも乗らない）
  const diff = Math.min(Math.abs(jobM - candM), 12 - Math.abs(jobM - candM));
  const fit = diff === 0 ? 1 : diff === 1 ? 0.7 : diff === 2 ? 0.4 : diff === 3 ? 0.2 : 0.05;
  return { fit, jobM, candM, known: true };
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
/** job.detail 内の "30代まで" "20〜40代" "若手" を解釈し、候補の age_band と適合度を返す。
 *   known=true は「案件の年代要件と候補の年代が両方分かっていて適合判定済み」または
 *   「案件側に年代要件が無く問題なし」のいずれか。情報不足で判定できない場合は known=false。
 *   ※ 単独の "X代" や "X代まで/以下" は **上限のみ** として解釈する（下限なし＝若い候補も適合）。
 *      "X代以上/以降" は下限のみ。"X〜Y代" のような範囲表現のみ両側で判定。
 *      これにより、案件側の希望年齢範囲内の候補（特に若い側）が誤ってミスマッチ判定されるのを防ぐ。 */
function ageFit(job: Job, c: Candidate): { fit: number; mismatch: boolean; jobRange: string | null; known: boolean } {
  const candAge = ageOfBand(c.age_band);
  const text = `${job.detail ?? ""} ${job.title ?? ""}`;
  const bands = bandsOfText(text);
  const youngOnly = /若手|ヤング/.test(text);
  const seniorOnly = /シニア|ベテラン/.test(text);
  // 一方向制約の検出（"X代まで"/"以下"/"以内" → 上限のみ、"X代以上"/"以降"/"超" → 下限のみ）。
  const hasUpperModifier = /[1-9]0\s*代\s*(?:まで|以下|以内)/.test(text);
  const hasLowerModifier = /[1-9]0\s*代\s*(?:以上|以降|超)/.test(text);
  // 明示的な範囲表現（"X〜Y代" や "X代〜Y代"）の両端を取得。
  //   bandsOfText は "代" を要求するため "20〜40代" は [40] しか拾わない（下限を取り損ねる）。
  //   ここでは範囲表現を直接マッチさせて lo/hi の両方を確保する。
  const rangeMatch = text.match(/([1-9]0)\s*代?\s*[〜~\-から]\s*([1-9]0)\s*代/);
  const hasRange = !!rangeMatch;
  const rangeLo = rangeMatch ? Math.min(Number(rangeMatch[1]), Number(rangeMatch[2])) : null;
  const rangeHi = rangeMatch ? Math.max(Number(rangeMatch[1]), Number(rangeMatch[2])) : null;
  // 案件側に年代要件無し かつ 候補年代不明 → 不確実だが減点しすぎないよう中庸
  if (candAge == null) {
    if (bands.length === 0 && !youngOnly && !seniorOnly) return { fit: 0.7, mismatch: false, jobRange: null, known: false };
    return { fit: 0.5, mismatch: false, jobRange: bands.length ? `${bands.join("〜")}代` : (youngOnly ? "若手" : "シニア"), known: false };
  }
  // 案件側に年代要件無し（条件なし） → 候補は何歳でも適合
  if (bands.length === 0 && !youngOnly && !seniorOnly) return { fit: 1, mismatch: false, jobRange: null, known: true };
  if (youngOnly && candAge >= 50) return { fit: 0.1, mismatch: true, jobRange: "若手", known: true };
  if (seniorOnly && candAge < 30) return { fit: 0.3, mismatch: true, jobRange: "シニア", known: true };
  if (bands.length) {
    const minB = Math.min(...bands), maxB = Math.max(...bands);
    // 下限・上限の決定:
    //   ・範囲表現あり（"X〜Y代"）  → 両側（lo=min, hi=max）
    //   ・"X代まで/以下/以内" のみ → 上限のみ（lo=null, hi=max）
    //   ・"X代以上/以降/超" のみ   → 下限のみ（lo=min, hi=null）
    //   ・修飾語なしの単独 "X代"    → 上限として解釈（若い候補を年齢で弾かない＝要望対応）
    let lo: number | null;
    let hi: number | null;
    let raw: string;
    if (hasRange && rangeLo !== null && rangeHi !== null) {
      lo = rangeLo; hi = rangeHi; raw = lo === hi ? `${lo}代` : `${lo}〜${hi}代`;
    } else if (hasLowerModifier && !hasUpperModifier) {
      lo = minB; hi = null; raw = `${minB}代〜`;
    } else {
      // 上限あり or 修飾語なし: 上限制約とみなす
      lo = null; hi = maxB; raw = `〜${maxB}代`;
    }
    const tooOld = hi !== null && candAge > hi;
    const tooYoung = lo !== null && candAge < lo;
    if (!tooOld && !tooYoung) return { fit: 1, mismatch: false, jobRange: raw, known: true };
    if (tooOld) {
      const diff = candAge - (hi as number);
      return { fit: diff <= 10 ? 0.4 : 0.1, mismatch: diff > 10, jobRange: raw, known: true };
    }
    // 下限割れ（明示的に "X代以上" のときのみ）: 大きく外れる場合のみミスマッチ。
    const diff = (lo as number) - candAge;
    return { fit: diff <= 10 ? 0.5 : 0.2, mismatch: diff > 15, jobRange: raw, known: true };
  }
  return { fit: 0.7, mismatch: false, jobRange: null, known: false };
}

// ---- 国籍ハードフィルター ----
/** 案件が「日本国籍のみ」（画面バッジと同じ classifyJobNationality 判定）で、
 *   候補が「外国籍」の場合に true（ランキングから除外）。
 *   候補が「日本国籍」または「不明」（空欄/不問を含む）は除外しない（担当が確認する運用）。 */
function nationalityHardNg(job: Job, c: Candidate): boolean {
  if (classifyJobNationality(job.detail, job.title) !== "jp_only") return false;
  return classifyCandNationality(c.nationality) === "foreign";
}
function nationalityWarn(job: Job, c: Candidate): boolean {
  const text = `${job.detail ?? ""} ${job.title ?? ""}`;
  const requiresJp = /日本国籍|日本人|外国籍/i.test(text);
  return requiresJp && !(c.nationality && /日本|JP|Japan/i.test(c.nationality));
}

// ---- 勤務形態ハードフィルター ----
/** 案件が「出社必須」(remote_type=onsite) で、候補がリモート/在宅を希望（出社不可）の場合に true。
 *   「出社可」「常駐可」等（"可"を含む）や、リモート希望の記載なし（不明/空欄）は除外しない。
 *   例）「フルリモート希望」「一部在宅希望」→ 除外 ／「出社可」「不明」「空欄」→ 残す。 */
function remoteHardNg(job: Job, c: Candidate): boolean {
  if (job.remote_type !== "onsite") return false;
  const cp = (c.remote_pref ?? "").trim();
  if (!cp) return false; // 不明・空欄は除外しない
  const wantsRemote = /リモート|在宅/.test(cp);
  const onsiteOk = /出社|常駐|可/.test(cp);
  return wantsRemote && !onsiteOk; // 在宅/リモート希望 かつ 出社可の記載なし → 除外
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
// プロパー必須案件（御社所属・正社員/契約社員のみ）か。これらは自社プロパーしか提案できない＝営業支援案件。
const PROPER_ONLY_JOBS = new Set(["jp_to_self", "jp_to_self_seishain"]);
function flowNotes(job: Job, c: Candidate, fm: ReturnType<typeof flowMatchMatrix>): Note[] {
  const notes: Note[] = [];
  const jl = JOB_FLOW_LABEL[fm.jobCat];
  const cl = CAND_FLOW_LABEL[fm.candCat];
  const properOnly = PROPER_ONLY_JOBS.has(fm.jobCat);
  if (fm.compat === "ng") {
    const extra = properOnly ? "（プロパー必須案件：自社所属の社員でないと提案不可）" : "（互換性マトリックスで不可）";
    notes.push({ level: "red", text: `商流NG：案件「${jl}」／人材「${cl}」${extra}` });
  } else if (fm.compat === "ok") {
    if (properOnly && fm.candCat === "self_emp") {
      notes.push({ level: "green", text: `★ 営業支援（自社プロパー配置）：案件「${jl}」に自社社員を提案できる優先案件` });
    } else {
      notes.push({ level: "green", text: `商流OK：案件「${jl}」／人材「${cl}」` });
    }
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

// ---- 尚可（向可）スキル：案件本文(detail)の【尚可/向可スキル】セクションを抽出し、
//   候補スキルがそこに含まれるかで「歓迎要件の充足」を加点する（必須に次ぐ第2軸）。
const NICE_HEADER_RE = /【\s*(?:尚可|向可|歓迎|あれば尚可|尚\s?可)[^】]*】/;
export function preferredSkillMatch(job: Job, c: Candidate): string[] {
  const detail = (job.detail ?? "").toString();
  if (!detail) return [];
  const idx = detail.search(NICE_HEADER_RE);
  if (idx < 0) return [];
  // 見出し以降〜次の見出し/区切りまでを尚可セクションとみなす
  const after = detail.slice(idx + (detail.slice(idx).match(NICE_HEADER_RE)?.[0]?.length ?? 0));
  const end = after.search(/【|＝{3,}|─{3,}|━{3,}|∞{3,}|\n\s*\n\s*\n/);
  const section = (end >= 0 ? after.slice(0, end) : after).toLowerCase();
  if (!section.trim()) return [];
  // 多重チェック（第2軸：尚可スキル）。①候補の skills[] と尚可セクションの照合 →
  // ②候補の経歴/PR本文にもセクション内の各スキル候補が出ているかを substring 走査。
  // 短いトークンの誤検出を避けるため、配列照合は従来どおりトリム/canon の包含で、
  // 本文照合はセクション内の "明らかなスキル名らしき" 部分（句読点/区切りで分割）で行う。
  const matched: string[] = [];
  for (const s of (c.skills ?? [])) {
    const raw = String(s ?? "").trim().toLowerCase();
    const cn = canon(s).toLowerCase();
    if ((raw && section.includes(raw)) || (cn && section.includes(cn))) matched.push(s);
  }
  return Array.from(new Set(matched));
}

// ---- 経験業務カテゴリ：案件(role_label+title)と候補(title+exp)の役割カテゴリが一致するか。
//   候補の経験テキスト(exp)も見て、より確度高くカテゴリ一致を判定する（第3軸）。
export function experienceCategoryMatch(job: Job, c: Candidate): { jobCat: string | null; candCat: string | null; match: boolean } {
  const jobCat = roleGroup([job.role_label, job.title].filter(Boolean).join(" "));
  const candCat = roleGroup([c.title, c.exp].filter(Boolean).join(" "));
  return { jobCat, candCat, match: !!jobCat && jobCat === candCat };
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
  // 完全一致用（candExactSet）と、内包（子→親）を含めた充足判定用（candSet）。
  //   例: 人材が「Spring/Amazon EC2」を持てば「Java/AWS」要件も満たすとみなす（取りこぼし低減）。
  const candExactSet = new Set((c.skills ?? []).map(canon));
  const candSet = expandSkillSet(c.skills ?? []);
  const origJobSkills = job.skills ?? [];
  // ── 多重チェック（第1軸：必須スキル）─────────────────────────────────────
  //   ①配列(skills[])での canon 一致 → ②本文(経歴/PR/職種/会社/スキルシート要約)に
  //   スキル名の言及があるかの正規表現マッチ、の順で照合する。
  //   営業/取込時点で skills[] への登録が漏れていても、本文に明記があれば「救う」ことで、
  //   案件企業側の「土俵に乗らない」誤判定を減らす。本文ヒットしたぶんは UI で
  //   「スキル列に未登録（登録推奨）」として区別表示する。
  const candText = [c.exp, c.note, (c as any).skill_sheet_summary, c.title, c.company]
    .filter(Boolean).map((s) => String(s)).join("\n");
  const matchedSkills: string[] = []; const missingSkills: string[] = []; const textHitSkills: string[] = []; const impliedSkills: string[] = [];
  origJobSkills.forEach((s, i) => {
    if (candSet.has(jobSkills[i])) {
      matchedSkills.push(s);
      if (!candExactSet.has(jobSkills[i])) impliedSkills.push(s); // 内包（関連スキル）で充足
      return;
    }
    if (candText) {
      const re = skillMentionRegex(s);
      if (re && re.test(candText)) { matchedSkills.push(s); textHitSkills.push(s); return; }
    }
    missingSkills.push(s);
  });
  const skillPct = jobSkills.length ? matchedSkills.length / jobSkills.length : (c.skills?.length ? 0.3 : 0);

  const { fit: salaryFit, overage, margin, known: salaryKnown } = salaryGap(job, c);
  const { fit: remoteFitV, known: remoteKnown } = remoteFit(job.remote_type, c.remote_pref);
  const timing = timingFit(job, c);
  const age = ageFit(job, c);
  const ind = industryMatch(job, c);
  const ngNat = nationalityHardNg(job, c);
  const ngRemote = remoteHardNg(job, c);
  const fm = flowMatchMatrix(job, c);
  const flowNg = fm.compat === "ng";

  // ---- 100点配点 ----
  const skill100 = Math.round(skillPct * 100);            // 0-100（重み80）
  const salary100 = Math.round(salaryFit * 100);          // 0-100（重み8）
  const remote100 = Math.round(remoteFitV * 100);         // 0-100（重み5）
  const timing100 = Math.round(timing.fit * 100);         // 0-100（重み4）
  const age100 = Math.round(age.fit * 100);               // 0-100（重み3）

  let weighted = skill100 * 0.80 + salary100 * 0.08 + remote100 * 0.05 + timing100 * 0.04 + age100 * 0.03;

  // ---- 尚可スキル・経験カテゴリ（第2・第3軸）----
  const niceMatched = preferredSkillMatch(job, c);        // 尚可スキルの充足
  const expCat = experienceCategoryMatch(job, c);          // 経験業務カテゴリの一致

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
  // ② 尚可スキル：充足ぶんを加点（最大 +4）。必須に次ぐ歓迎要件。
  if (niceMatched.length > 0) bonus += Math.min(4, niceMatched.length);
  // ③ 経験業務カテゴリ一致 +2 / 不一致は減点せず注意のみ。
  if (expCat.match) bonus += 2;

  // ---- ハードフィルター ----
  //   baseScore: 5次元のみのスコア（0-100）。ボーナスを含めない。
  //   score    : baseScore + ボーナス を 0-100 にキャップ。
  //   どちらも 100% に乗せるには「全次元が known かつ満点」が必要。
  //   1つでも known=false（情報不明）があると、5次元の合計が満点に届かないため、
  //   "情報不足のまま100%" を構造的に防げる。
  const allKnown = salaryKnown && remoteKnown && timing.known && age.known;
  // 100% は「全次元 known かつ全て満点」のときだけ許す。それ以外は最大99に丸める。
  let baseScore = Math.round(weighted);
  if (!allKnown && baseScore >= 100) baseScore = 99;
  let score = Math.round(Math.min(100, baseScore + bonus));
  if (!allKnown && score >= 100) score = 99;
  if (ngNat || ngRemote) { score = 0; baseScore = 0; }
  // ① 必須スキルゲート（最優先・多重チェック）：
  //   案件企業は「必須スキル」で土俵が決まる。一致率が低い候補は、単価/勤務/経験が良くても
  //   上位・提案推奨に出さない。重み付けスコアに加え、ここで上限を被せて二重に担保する。
  //   ・必須の半分未満 → 49点上限（＝提案推奨にしない）
  //   ・必須の1/4未満 → 29点上限（＝提案不可圏）
  if (!ngNat && jobSkills.length > 0) {
    if (skillPct < 0.25) score = Math.min(score, 29);
    else if (skillPct < 0.5) score = Math.min(score, 49);
  }
  // 単価大幅超過のセーフティ（旧ロジック踏襲：致命差は上限を被せる）
  if (!ngNat && overage != null && overage > 20) score = Math.min(score, 40);
  else if (!ngNat && overage != null && overage > 10) score = Math.min(score, 65);
  // 商流NG（例：プロパー必須案件に BP/協力会社の人材）は提案できない実質ミスマッチ。
  //   スキル100%でも上位に出さないよう、マッチ率に上限35点を被せる（除外はせず表示は残す）。
  if (!ngNat && flowNg) score = Math.min(score, 35);

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

  if (ngNat) notes.push({ level: "red", text: "国籍要件NG（日本国籍のみの案件に外国籍の人材）" });
  else if (nationalityWarn(job, c)) notes.push({ level: "yellow", text: "国籍要件に言及あり（候補の国籍を要確認）" });
  if (ngRemote) notes.push({ level: "red", text: "勤務形態NG（出社必須の案件にリモート/在宅希望の人材）" });

  if (jobSkills.length) {
    // 完全一致は「全件が skills 列で直接一致」のときのみ。内包/本文ヒットを含む場合は「充足」と表記。
    if (matchedSkills.length === jobSkills.length) notes.push({ level: "green", text: `必須スキル ${jobSkills.length}/${jobSkills.length} ${impliedSkills.length === 0 && textHitSkills.length === 0 ? "完全一致" : "充足"}` });
    else if (skillPct >= 0.8) notes.push({ level: "green", text: `必須スキル ${matchedSkills.length}/${jobSkills.length} 一致（不足: ${missingSkills.slice(0, 3).join("・")}）` });
    else if (skillPct >= 0.5) notes.push({ level: "yellow", text: `必須スキル一部欠落 ${matchedSkills.length}/${jobSkills.length}（不足: ${missingSkills.slice(0, 3).join("・")}）` });
    else notes.push({ level: "red", text: `🚫 必須スキル不足 ${matchedSkills.length}/${jobSkills.length}（土俵に乗りにくい・不足: ${missingSkills.slice(0, 3).join("・")}）` });
    // 本文ヒットで救った必須スキルがあれば、登録漏れの是正を促す（注意喚起）。
    if (textHitSkills.length > 0) {
      notes.push({ level: "yellow", text: `必須スキル ${textHitSkills.slice(0, 3).join("・")} は人材のスキル列に未登録（経歴/PRに記載あり・登録推奨）` });
    }
    // 内包（関連スキル）で充足したものは、判断材料として明示（例: EC2→AWS, Spring→Java）。
    if (impliedSkills.length > 0) {
      notes.push({ level: "green", text: `関連スキルで充足 ${impliedSkills.slice(0, 3).join("・")}（保有スキルが要件を内包）` });
    }
  }
  // ② 尚可スキル：充足があれば緑で加点理由を明示
  if (niceMatched.length > 0) notes.push({ level: "green", text: `尚可スキル一致（${niceMatched.slice(0, 4).join("・")}）` });
  // ③ 経験業務カテゴリ
  if (expCat.match) notes.push({ level: "green", text: `経験業務カテゴリ一致（${expCat.jobCat}）` });
  else if (expCat.jobCat && expCat.candCat && expCat.jobCat !== expCat.candCat) notes.push({ level: "yellow", text: `経験業務カテゴリに差（案件: ${expCat.jobCat} / 候補: ${expCat.candCat}）要確認` });

  if (overage != null && overage > 20) notes.push({ level: "red", text: `単価が予算より約${overage}万円高く調整困難` });
  else if (overage != null && overage > 10) notes.push({ level: "yellow", text: `単価が予算より約${overage}万円高い（要交渉）` });
  else if (margin != null && margin >= 5 && margin <= 10) notes.push({ level: "green", text: `マージン理想圏（約${margin}万円の余裕）` });
  else if (margin != null && margin > 10) notes.push({ level: "green", text: `単価に余裕あり（約${margin}万円の余裕）` });
  else if (overage == null) notes.push({ level: "yellow", text: "単価情報が不足／要相談（交渉で調整可）" });

  if (remoteFitV >= 0.9) notes.push({ level: "green", text: "勤務形態 適合" });
  else if (remoteFitV >= 0.6) notes.push({ level: "yellow", text: "勤務形態に軽微なズレ（要確認）" });
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
  const hardExcluded = ngNat || ngRemote || open.closed;
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
    baseScore,
    bonus,
    matchedSkills, missingSkills, reasons, notes,
    verdict,
    excluded: hardExcluded || undefined,
    flow: { compat: fm.compat, jobCat: fm.jobCat, candCat: fm.candCat, jobLabel: JOB_FLOW_LABEL[fm.jobCat], candLabel: CAND_FLOW_LABEL[fm.candCat] },
    breakdown: { skill: skill100, salary: salary100, remote: remote100, timing: timing100, age: age100, bonus },
    dims: {
      skill:  { pct: skill100,  known: jobSkills.length > 0 },
      salary: { pct: salary100, known: salaryKnown },
      remote: { pct: remote100, known: remoteKnown },
      timing: { pct: timing100, known: timing.known },
      age:    { pct: age100,    known: age.known },
    },
  };
}

/** 候補配列を job に対してスコアリングし降順に並べて返す。
 *  スコア同点は「新着（candidate.created_at が新しい）」を優先し、古い人材が上位に居座らないようにする。 */
// 案件側マッチング（案件→人材）の追加除外ルール（要望対応）。
//   既存スコアリング/除外を優先したうえで、さらに以下を満たさない人材をランキングから外す。
//   ① 勤務形態：案件が「一部リモート」(partial_remote)なら、フルリモート希望（出社不可）の人材を除外。
//      「出社可」「一部リモート可」「不明(空欄)」は残す（"可"や"フル/完全リモート"でない記載は対象外）。
//   ② 利益確保：人材の希望単価(下限)が「案件の提示上限 − 3万円」を超える人材を除外（同額・僅差を排除）。
//      例）案件上限70万 → 希望67万以下のみ対象、68万以上は除外。単価不明・上限不明のときは判定しない。
// 案件テキストから年齢上限を抽出（"45歳まで/以下/以内" や "20〜45歳" → ageCap、
//   "40代まで/以下" や "30〜40代" → decadeCap）。"以上/以降" などの下限指定は無視。
function parseJobAgeLimit(job: Job): { ageCap: number | null; decadeCap: number | null } {
  const text = [job.title, (job as any).role_label, (job as any).flow_note, (job as any).detail].filter(Boolean).join(" ");
  let ageCap: number | null = null;
  let decadeCap: number | null = null;
  // 具体年齢の上限： "45歳まで/以下/以内/迄"
  const up = text.match(/([1-9][0-9])\s*[歳才]\s*(?:まで|以下|以内|迄)/);
  if (up) ageCap = Number(up[1]);
  // 範囲の上端： "20〜45歳"
  if (ageCap == null) {
    const r = text.match(/([1-9][0-9])\s*[〜～~\-－ー]\s*([1-9][0-9])\s*[歳才]/);
    if (r) ageCap = Number(r[2]);
  }
  // 年代の上限： "40代まで/以下/以内/迄"
  const dUp = text.match(/([1-9]0)\s*代\s*(?:まで|以下|以内|迄)/);
  if (dUp) decadeCap = Number(dUp[1]);
  // 範囲の上端： "30〜40代" / "30代〜40代"
  if (decadeCap == null) {
    const dr = text.match(/([1-9]0)\s*代?\s*[〜～~\-－ー]\s*([1-9]0)\s*代/);
    if (dr) decadeCap = Number(dr[2]);
  }
  return { ageCap, decadeCap };
}

// 人材の年代グループから「年代（decade）」と「上限年齢（hi）」を返す。判定不能（不明）なら null。
//   前半→decade+4 / 後半→decade+9 / 修飾なし→decade+9 を上限とする。
function candAgeRange(c: Candidate): { decade: number; hi: number } | null {
  const b = String(c.age_band ?? "").trim();
  const m = b.match(/([1-9]0)\s*代/);
  if (!m) return null;
  const decade = Number(m[1]);
  const hi = /前半/.test(b) ? decade + 4 : decade + 9;
  return { decade, hi };
}

function passesJobSideFilters(job: Job, c: Candidate): boolean {
  // ① 勤務形態
  if (job.remote_type === "partial_remote") {
    const cp = (c.remote_pref ?? "").trim();
    const onsiteOk = /出社|常駐|可/.test(cp);
    const wantsFull = /フル|完全/.test(cp) && /リモート|在宅/.test(cp);
    if (wantsFull && !onsiteOk) return false;
  }
  // ② 単価マージン（最低3万円の差を確保）
  const jMax = job.salary_max ?? null;
  if (jMax != null) {
    const cMin = candRange(c).min;
    if (cMin != null && cMin > jMax - 3) return false;
  }
  // ③ 年齢・年代の上限（安全側＝条件オーバーは除外。人材の年齢/年代が不明なら除外しない）。
  //   ・"〇〇歳まで" … 人材の年代グループの上限年齢が案件上限を超えるなら除外
  //       例) 45歳まで：40代前半(〜44)=表示 / 40代後半(〜49)=除外 / 30代後半(〜39)=表示
  //   ・"〇〇代まで" … 指定年代より上の年代グループは一律除外（例: 40代まで→50代/60代は除外）
  const { ageCap, decadeCap } = parseJobAgeLimit(job);
  if (ageCap != null || decadeCap != null) {
    const ar = candAgeRange(c); // 不明(null)は除外対象にしない
    if (ar) {
      if (ageCap != null && ar.hi > ageCap) return false;
      if (decadeCap != null && ar.decade > decadeCap) return false;
    }
  }
  return true;
}

export function rankCandidates(job: Job, candidates: Candidate[], limit = 30) {
  const now = Date.now();
  const scored = candidates
    .map((c) => ({ candidate: c, ...scoreMatch(job, c) }))
    .filter((r) => !r.excluded)
    // 既存ロジックを通過した候補に、案件側の追加ルール（勤務形態・単価マージン）を適用。
    .filter((r) => passesJobSideFilters(job, r.candidate))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同点 → 新しい登録を優先（created_at 降順）。created_at 無しは後ろへ。
      const ta = a.candidate.created_at ? new Date(a.candidate.created_at).getTime() : 0;
      const tb = b.candidate.created_at ? new Date(b.candidate.created_at).getTime() : 0;
      return tb - ta;
    });
  return collapseSamePeople(scored).slice(0, limit);
}

// 人材側マッチング（人材→案件）の追加除外ルール（要望対応）。案件ランキングから外す。
//   ① リモート：人材が「フル/一部リモート希望」なら、案件が「出社必須」(onsite)の案件を除外。
//      ＝人材が出社可（出社/常駐の記載）の場合は除外しない。
//   ② 利益確保：案件の提示上限が「人材の希望下限＋3万円」未満なら除外（最低3万円のマージン確保）。
//      例）人材65万〜 → 案件上限68万以上のみ対象。〜60万 や 60万固定は除外。単価不明は判定しない。
function passesCandSideFilters(cand: Candidate, job: Job): boolean {
  // ① リモート希望 vs 出社必須
  const cp = (cand.remote_pref ?? "").trim();
  const wantsRemote = (cp === "full_remote" || cp === "partial_remote"
    || (/リモート|在宅/.test(cp) && !/出社|常駐/.test(cp)));
  if (wantsRemote && job.remote_type === "onsite") return false;
  // ② 単価マージン（最低3万円の差を確保）
  const cMin = candRange(cand).min;
  const jMax = job.salary_max ?? null;
  if (cMin != null && jMax != null && jMax < cMin + 3) return false;
  return true;
}

/** 案件配列を 1 人材に対してスコアリングし降順に並べて返す */
export function rankJobs(candidate: Candidate, jobs: Job[], limit = 30) {
  return jobs
    .map((j) => ({ job: j, ...scoreMatch(j, candidate) }))
    .filter((r) => !r.excluded)
    // 既存ロジックを通過した案件に、人材側の追加ルール（リモート希望・単価マージン）を適用。
    .filter((r) => passesCandSideFilters(candidate, r.job))
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
