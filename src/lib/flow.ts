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
