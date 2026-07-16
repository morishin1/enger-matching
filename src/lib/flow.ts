// 商流（深さ）の判定・整合性チェック。クライアント/サーバ両用の純粋モジュール。
//
//   ▼ モデル：自社（エイト）を起点に「下に何社挟むか」を整数で扱う。
//     ・人材深さ（cand depth）: 0=PP/プロパー(自社社員)
//                              1=一社下（協力会社の社員/フリーランス）
//                              2=二社下以降（多重）
//                              null=不明
//     ・案件の受入上限（job maxDepth）: 0=エイトまで(=PPのみ受入)
//                                       1=一社先まで
//                                       2=二社先まで（実質制限なし）
//                                       null=不明
//   ▼ 整合: cand <= job → OK ／ cand > job → NG ／ どちらか不明 → unknown
//   ▼ 役立ち先：マッチング画面のバッジ・スコア・提案時の確認ダイアログ。
//
//   ※ 案件メールには「エイトまで」「一社先まで」「弊社一次請け」など多様な表記が出る。
//      自動推定で取りこぼしを減らしつつ、フィールド（accept_flow_depth）で手動修正できる二段構え。

export type FlowDepth = 0 | 1 | 2;
export type FlowCompat = "ok" | "ng" | "unknown";

const DEPTH_LABEL_CAND: Record<0 | 1 | 2, string> = {
  0: "PP（プロパー）",
  1: "一社下",
  2: "二社下以降",
};
const DEPTH_LABEL_JOB: Record<0 | 1 | 2, string> = {
  0: "エイトまで（PPのみ）",
  1: "一社先まで",
  2: "二社先まで",
};

export const candDepthLabel = (d: FlowDepth | null) => d == null ? "不明" : DEPTH_LABEL_CAND[d];
export const jobDepthLabel = (d: FlowDepth | null) => d == null ? "不明" : DEPTH_LABEL_JOB[d];

/** 整合判定。両方既知 かつ cand > job のときだけ NG。どちらか null は unknown。 */
export function flowCompat(candDepth: FlowDepth | null, jobMaxDepth: FlowDepth | null): FlowCompat {
  if (candDepth == null || jobMaxDepth == null) return "unknown";
  return candDepth <= jobMaxDepth ? "ok" : "ng";
}

// ── 自動推定 ─────────────────────────────────────────────────────────
//   ・人材：affiliation（PP/BP/FL）と AI抽出時の「一社下社員 / 二社下以降」等の表記から
//   ・案件：flow_note と detail/title 本文から（「エイトまで」「直案件」「二社下不可」等）
//
//   既知のフィールドが空でも、本文の言い回しから拾えるよう冗長に書いてある。

const norm = (s?: string | null) => (s ?? "").toString();

// 「二社下以降」「三社下」「多重」「孫請け」など、深さ2 を示唆する語
const RE_DEEP2 = /(二|2|三|3|四|4)\s*社\s*(下|先)|二社以降|多重|孫請|ひ孫請/;
// 「一社下」「一次下請」など、深さ1 を示唆する語
const RE_DEPTH1 = /(一|1)\s*社\s*(下|先)|一次\s*下|一次下請|一次協力|一社下フリーランス|一社下社員|協力会社/;
// プロパー（自社）を示唆する語。affiliation が PP の場合も同じ判定。
const RE_PP = /\b(PP|プロパー|自社社員|自社\s*社員|社員)\b/;

/** 人材の深さを affiliation や説明文から推定。 */
export function inferCandDepth(opts: { affiliation?: string | null; note?: string | null; company?: string | null }): FlowDepth | null {
  const text = `${norm(opts.affiliation)} ${norm(opts.note)} ${norm(opts.company)}`;
  if (!text.trim()) return null;
  // 優先順位：深さの明示語 > 区分（PP/BP/FL）
  if (RE_DEEP2.test(text)) return 2;
  if (RE_DEPTH1.test(text)) return 1;
  const aff = norm(opts.affiliation).toUpperCase();
  if (aff === "PP" || RE_PP.test(text)) return 0;
  // BP/FL のみ判明している場合は「一社下」を既定（最も一般的なケース）
  if (aff === "BP" || aff === "FL") return 1;
  if (/BP|ビジネスパートナー|協力/i.test(text)) return 1;
  if (/フリー(ランス)?|個人事業|FL/i.test(text)) return 1;
  return null;
}

// 案件側：受入上限を示唆する語
//   ・「エイトまで」「弊社まで」「自社まで」「直案件」「直請けのみ」「プロパーのみ」 → 0
//   ・「一社先まで」「一次まで」「一社下まで」「2社まで」「弊社+1まで」 → 1
//   ・「二社下まで」「二社先まで」「3社まで」 → 2
//   ・「二社下不可」「2社下不可」 → 1（=一社先までは可）
const RE_JOB_0 = /エイト\s*まで|弊社\s*まで|自社\s*まで|当社\s*まで|直\s*(案件|請|請け)|直\s*請けのみ|エンド\s*直|プロパー\s*のみ|社員\s*のみ/;
const RE_JOB_1 = /一\s*社\s*(先|下)\s*まで|1\s*社\s*(先|下)\s*まで|一次\s*まで|弊社\s*\+?\s*1\s*まで|二社下\s*不可|2\s*社下\s*不可|二\s*社下\s*以降\s*不可/;
const RE_JOB_2 = /二\s*社\s*(先|下)\s*まで|2\s*社\s*(先|下)\s*まで|3\s*社\s*まで|多重\s*可|商流\s*不問/;

/** 案件の受入上限を flow_note + 本文から推定。 */
export function inferJobMaxDepth(opts: { flow_note?: string | null; detail?: string | null; title?: string | null }): FlowDepth | null {
  const flow = norm(opts.flow_note);
  const text = `${flow} ${norm(opts.detail)} ${norm(opts.title)}`;
  if (!text.trim()) return null;
  if (RE_JOB_0.test(text)) return 0;
  if (RE_JOB_1.test(text)) return 1;
  if (RE_JOB_2.test(text)) return 2;
  return null;
}

/** 数値化（DB値が string/number/undefined 等で来ても 0/1/2/null に揃える）。 */
export function toFlowDepth(v: unknown): FlowDepth | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (n === 0 || n === 1 || n === 2) return n;
  return null;
}

/** 案件×人材の商流可否を「手動値 → 自動推定」のフォールバックで判定。 */
export function flowMatch(
  job: { accept_flow_depth?: number | null; flow_note?: string | null; detail?: string | null; title?: string | null },
  cand: { flow_depth?: number | null; affiliation?: string | null; note?: string | null; company?: string | null },
): { compat: FlowCompat; jobMaxDepth: FlowDepth | null; candDepth: FlowDepth | null; jobSource: "manual" | "auto" | "none"; candSource: "manual" | "auto" | "none" } {
  const jManual = toFlowDepth(job.accept_flow_depth);
  const cManual = toFlowDepth(cand.flow_depth);
  const jAuto = jManual == null ? inferJobMaxDepth({ flow_note: job.flow_note, detail: job.detail, title: job.title }) : null;
  const cAuto = cManual == null ? inferCandDepth({ affiliation: cand.affiliation, note: cand.note, company: cand.company }) : null;
  const jobMaxDepth = jManual ?? jAuto;
  const candDepth = cManual ?? cAuto;
  return {
    compat: flowCompat(candDepth, jobMaxDepth),
    jobMaxDepth, candDepth,
    jobSource: jManual != null ? "manual" : jAuto != null ? "auto" : "none",
    candSource: cManual != null ? "manual" : cAuto != null ? "auto" : "none",
  };
}

// バッジの色トーン（既存の国籍バッジに合わせる）
type Tone = { bg: string; fg: string; bd: string };
export const FLOW_TONE: Record<FlowCompat, Tone> = {
  ok:      { bg: "#e7f7ee", fg: "#067647", bd: "#bfe3cc" },
  ng:      { bg: "#fdecef", fg: "#b42318", bd: "#f7c5cf" },
  unknown: { bg: "#f3f4f6", fg: "#6b7280", bd: "#e5e7eb" },
};
export const FLOW_LABEL: Record<FlowCompat, string> = { ok: "商流OK", ng: "商流NG", unknown: "商流要確認" };

// ─── 新マトリックスによる商流互換性 ────────────────────────────────────────
// 旧モデル（深さ 0/1/2）では「正社員までに限る」「BP不可」のような区別ができない。
// 業務側で確定したマトリックス（9行×5列）に従って判定する。
//   行（案件の受入商流）= JobFlowCategory
//   列（人材の所属区分）= CandFlowCategory
//   案件側「貴社一社正社員まで」と「貴社一社先正社員まで」は同義なので
//   1つのカテゴリ jp_to_1_seishain に統合（ドロップダウン表示は前者のみ）。

export type JobFlowCategory =
  | "jp_to_self"          // 貴社まで
  | "jp_to_self_seishain" // 貴社正社員まで
  | "jp_to_1"             // 貴社一社まで
  | "jp_to_1_seishain"    // 貴社一社正社員まで（≒貴社一社先正社員まで）
  | "jp_to_2"             // 貴社二社まで
  | "jp_to_2_seishain"    // 貴社二社正社員まで
  | "any"                 // 商流不問
  | "unknown";            // 不明

export type CandFlowCategory =
  | "self_emp"      // エイト社員（自社正社員）
  | "self_bp"       // BP（自社のBP/FL）
  | "vendor1_emp"   // 一社下社員
  | "vendor1_fl"    // 一社下FL
  | "vendor2plus"   // 二社下以降
  | "unknown";      // 不明

// フィルタ等の「表示ラベル」。value（カテゴリ）と DB 保存値(JOB_FLOW_LABEL)は不変で、表示のみここで定義。
export const JOB_FLOW_OPTIONS: { value: Exclude<JobFlowCategory, "unknown">; label: string }[] = [
  { value: "jp_to_self",          label: "貴社まで" },
  { value: "jp_to_self_seishain", label: "貴社社員まで" },
  { value: "jp_to_1",             label: "貴社一社先まで" },
  { value: "jp_to_1_seishain",    label: "貴社一社先社員まで" },
  { value: "jp_to_2",             label: "貴社二社先まで" },
  { value: "jp_to_2_seishain",    label: "貴社二社先社員まで" },
  { value: "any",                 label: "商流不問" },
];

export const CAND_FLOW_OPTIONS: { value: Exclude<CandFlowCategory, "unknown">; label: string }[] = [
  { value: "self_emp",    label: "エイト社員" },
  { value: "self_bp",     label: "弊社所属フリーランス" },  // #261：旧表記「BP」から文言変更（分類キー・判定は不変）
  { value: "vendor1_emp", label: "一社下社員" },
  { value: "vendor1_fl",  label: "一社下フリーランス" },  // #436①：旧表記「一社下FL」から文言変更（分類キー・判定は不変。旧値は classifyCandFlow のフォールバックで拾う）
  { value: "vendor2plus", label: "二社下以降" },
];

// #447②：文言変更（旧→新）。
//   貴社正社員まで→貴社社員まで／貴社一社まで→貴社一社先まで／貴社一社正社員まで→貴社一社先社員まで／
//   貴社二社まで→貴社二社先まで／貴社二社正社員まで→貴社二社先社員まで（貴社まで・商流不問は変更なし）。
//   classifyJobFlow の完全一致は Object.keys(JOB_FLOW_LABEL) を見るため、ここを更新すれば新規保存時の
//   自由文もそのまま新文言で正しく分類される。既存データ（旧文言の生テキスト）は完全一致こそ外れるが、
//   同関数の語彙ベース・フォールバック（正社員/一社/二社等の正規表現）で従来どおり正しく分類される。
export const JOB_FLOW_LABEL: Record<JobFlowCategory, string> = {
  jp_to_self: "貴社まで",
  jp_to_self_seishain: "貴社社員まで",
  jp_to_1: "貴社一社先まで",
  jp_to_1_seishain: "貴社一社先社員まで",
  jp_to_2: "貴社二社先まで",
  jp_to_2_seishain: "貴社二社先社員まで",
  any: "商流不問",
  unknown: "不明",
};
// #447②：旧文言（DBに残っている生テキスト）→新文言の単純置換マップ。
//   一覧・ドロワー等で「生の flow_note をそのまま表示」している箇所に使う。分類はせず完全一致のみ
//   置換するため、CSV取込・メール抽出等の任意の自由文（旧5値に一致しないもの）は変更せずそのまま表示する
//   （情報を失わないため）。
export const JOB_FLOW_RAW_RENAME: Record<string, string> = {
  "貴社正社員まで": "貴社社員まで",
  "貴社一社まで": "貴社一社先まで",
  "貴社一社正社員まで": "貴社一社先社員まで",
  "貴社二社まで": "貴社二社先まで",
  "貴社二社正社員まで": "貴社二社先社員まで",
};
/** 案件の商流（flow_note）表示用ラベル。旧文言の生テキストは新文言に置換し、それ以外はそのまま返す。 */
export function displayFlowNote(raw?: string | null): string {
  const t = (raw ?? "").trim();
  if (!t) return "";
  return JOB_FLOW_RAW_RENAME[t] ?? t;
}
export const CAND_FLOW_LABEL: Record<CandFlowCategory, string> = {
  self_emp: "エイト社員",
  self_bp: "弊社所属フリーランス",  // #261：旧表記「BP」から文言変更
  vendor1_emp: "一社下社員",
  vendor1_fl: "一社下フリーランス",  // #436①：旧表記「一社下FL」から文言変更
  vendor2plus: "二社下以降",
  unknown: "不明",
};

// 互換性マトリックス（業務側仕様）。
//   行=案件の受入商流 / 列=人材の所属区分 → ok / ng。
//   案件 "商流不問" は人材問わず ok（unknown のときは unknown を返す）。
//   案件 "不明" は判定不能 → unknown（NGにしないことで提案候補から外さない）。
//   人材 "unknown" は判定不能 → unknown。
//   ※ 「貴社二社正社員まで」の二社下以降は厳格には「二社下の正社員のみ」可だが、
//     人材カテゴリに「二社下社員/二社下FL」の区別が無いため、現状 ok として扱う。
const M: Record<Exclude<JobFlowCategory, "unknown" | "any">, Record<Exclude<CandFlowCategory, "unknown">, "ok" | "ng">> = {
  jp_to_self:          { self_emp: "ok", self_bp: "ok", vendor1_emp: "ng", vendor1_fl: "ng", vendor2plus: "ng" },
  jp_to_self_seishain: { self_emp: "ok", self_bp: "ng", vendor1_emp: "ng", vendor1_fl: "ng", vendor2plus: "ng" },
  jp_to_1:             { self_emp: "ok", self_bp: "ok", vendor1_emp: "ok", vendor1_fl: "ok", vendor2plus: "ng" },
  jp_to_1_seishain:    { self_emp: "ok", self_bp: "ok", vendor1_emp: "ok", vendor1_fl: "ng", vendor2plus: "ng" },
  jp_to_2:             { self_emp: "ok", self_bp: "ok", vendor1_emp: "ok", vendor1_fl: "ok", vendor2plus: "ok" },
  jp_to_2_seishain:    { self_emp: "ok", self_bp: "ok", vendor1_emp: "ok", vendor1_fl: "ng", vendor2plus: "ok" },
};

export function flowMatrixCompat(jobCat: JobFlowCategory, candCat: CandFlowCategory): FlowCompat {
  if (jobCat === "unknown" || candCat === "unknown") return "unknown";
  if (jobCat === "any") return "ok";
  return M[jobCat][candCat];
}

// ── テキスト → カテゴリ正規化 ───────────────────────────────────────────
//   案件の flow_note や人材の affiliation は自由テキストで保存されているため、
//   既存の自由文（「貴社まで」「一社下FL」など）をカテゴリに分類する。
//   完全一致を最優先し、無ければ語彙の出現で判定。

const n = (s?: string | null) => (s ?? "").toString().replace(/[\s　]/g, "");

/** 案件のテキスト（flow_note）から JobFlowCategory に分類。 */
export function classifyJobFlow(value?: string | null): JobFlowCategory {
  const t = n(value);
  if (!t) return "unknown";
  // 完全一致（DB値が既に正規ラベルの場合）。
  //   ※ フィルタの表示ラベル(JOB_FLOW_OPTIONS.label)とは独立に、正規ラベル(JOB_FLOW_LABEL＝DB保存値)で
  //     判定する。表示ラベルを変更しても分類が壊れないようにするため。
  for (const cat of Object.keys(JOB_FLOW_LABEL) as JobFlowCategory[]) {
    if (cat === "unknown") continue;
    if (t === n(JOB_FLOW_LABEL[cat])) return cat;
  }
  if (t === n("不明")) return "unknown";
  // 同義語：「貴社一社先正社員まで」＝「貴社一社正社員まで」。
  if (/貴社一社先正社員まで|一社先正社員まで/.test(t)) return "jp_to_1_seishain";
  // 言い回しベースのフォールバック（メール本文等から取り込んだ自由文）。
  if (/商流不問|不問/.test(t)) return "any";
  // 「正社員/契約社員/プロパー/直雇用」等は“貴社所属の社員のみ”＝正社員系へ寄せる。
  //   ※「契約社員」も自社の直雇用なのでプロパー(正社員系)として扱う。
  const seishain = /正社員|契約社員|プロパー|直雇用|社員のみ|社員限定/.test(t);
  if (/二社|2社/.test(t)) return seishain ? "jp_to_2_seishain" : "jp_to_2";
  if (/一社|1社|一次|\+1|プラス1/.test(t)) return seishain ? "jp_to_1_seishain" : "jp_to_1";
  // 自社（御社/貴社/弊社/当社/エイト/自社）所属・直案件・プロパー指定。「御社」「所属」「プロパー」も拾う。
  if (/御社|貴社|エイト|弊社|自社|当社|直案件|直請|直\s*請け|エンド直|プロパー|直雇用/.test(t)) return seishain ? "jp_to_self_seishain" : "jp_to_self";
  // 上記に当てはまらないが「プロパー/正社員のみ」だけ書かれているケースも自社正社員扱い。
  if (seishain && /プロパー|社員のみ|社員限定/.test(t)) return "jp_to_self_seishain";
  return "unknown";
}

/** 人材のテキスト（affiliation）から CandFlowCategory に分類。 */
export function classifyCandFlow(value?: string | null): CandFlowCategory {
  const t = n(value);
  if (!t) return "unknown";
  for (const o of CAND_FLOW_OPTIONS) if (t === n(o.label)) return o.value;
  // 同義語・略称
  if (/^pp$|プロパー|自社社員|エイト社員|自社\s*社員/i.test(t)) return "self_emp";
  if (/^bp$|ビジネスパートナー/i.test(t)) return "self_bp";
  if (/二社下|2社下|三社下|3社下|多重|孫請|二次以降|2次以降/.test(t)) return "vendor2plus";
  if (/一社下|1社下|一次/.test(t)) {
    if (/(FL|フリー|フリーランス|個人事業)/i.test(t)) return "vendor1_fl";
    if (/(社員|正社員)/.test(t)) return "vendor1_emp";
    return "vendor1_emp"; // 既定は社員扱い（一社下のみ表記）
  }
  if (/(FL|フリーランス|フリー|個人事業)/i.test(t)) return "self_bp"; // 自社経由のFLは BP 扱い
  return "unknown";
}

// 既存 flowMatch を「マトリックス判定」に差し替え（外部シグネチャは互換維持）。
//   ※ ファイル先頭の同名関数より、こちらの後勝ち定義が ESM のエクスポートになる。
//     旧 flowMatch（深さベース）は inferJobMaxDepth / inferCandDepth 経由でカテゴリへ翻訳。
function depthToJob(d: FlowDepth | null): JobFlowCategory {
  if (d == null) return "unknown";
  if (d === 0) return "jp_to_self";
  if (d === 1) return "jp_to_1";
  return "jp_to_2";
}
function depthToCand(d: FlowDepth | null): CandFlowCategory {
  if (d == null) return "unknown";
  if (d === 0) return "self_emp";
  if (d === 1) return "vendor1_emp";
  return "vendor2plus";
}

export function flowMatchMatrix(
  job: { accept_flow_depth?: number | null; flow_note?: string | null; detail?: string | null; title?: string | null },
  cand: { flow_depth?: number | null; affiliation?: string | null; note?: string | null; company?: string | null },
): { compat: FlowCompat; jobCat: JobFlowCategory; candCat: CandFlowCategory; jobSource: "manual" | "auto" | "none"; candSource: "manual" | "auto" | "none" } {
  // 1) 手動の深さがあれば最優先で使う（互換性のため）。
  const jManual = toFlowDepth(job.accept_flow_depth);
  const cManual = toFlowDepth(cand.flow_depth);
  // 2) 自由文から新マトリックスのカテゴリへ分類。
  const jByText = classifyJobFlow(job.flow_note);
  const cByText = classifyCandFlow(cand.affiliation);
  // 3) テキストで判定不能なら本文からの自動推定（旧ロジック）へフォールバック。
  const jAuto = jByText === "unknown"
    ? depthToJob(inferJobMaxDepth({ flow_note: job.flow_note, detail: job.detail, title: job.title }))
    : "unknown";
  const cAuto = cByText === "unknown"
    ? depthToCand(inferCandDepth({ affiliation: cand.affiliation, note: cand.note, company: cand.company }))
    : "unknown";
  const jobCat: JobFlowCategory = jManual != null ? depthToJob(jManual)
    : jByText !== "unknown" ? jByText
    : jAuto;
  const candCat: CandFlowCategory = cManual != null ? depthToCand(cManual)
    : cByText !== "unknown" ? cByText
    : cAuto;
  return {
    compat: flowMatrixCompat(jobCat, candCat),
    jobCat, candCat,
    jobSource: jManual != null ? "manual" : jByText !== "unknown" ? "manual" : jAuto !== "unknown" ? "auto" : "none",
    candSource: cManual != null ? "manual" : cByText !== "unknown" ? "manual" : cAuto !== "unknown" ? "auto" : "none",
  };
}
