// 注力(お気に入り)定義の型と評価ロジック（クライアント/サーバ両用・純粋関数のみ）。

export type FocusRule = {
  minRate: number | null;   // 単価下限（万）
  skills: string[];         // 重視スキル（いずれか合致）
  keywords: string[];       // 重視キーワード（名称・職種・詳細にいずれか含む）
  note: string;             // 補足メモ（アラートに表示）
};
export type FocusCriteria = { candidates: FocusRule; jobs: FocusRule };

export const EMPTY_RULE: FocusRule = { minRate: null, skills: [], keywords: [], note: "" };
export const DEFAULT_FOCUS_CRITERIA: FocusCriteria = { candidates: { ...EMPTY_RULE }, jobs: { ...EMPTY_RULE } };

export type FocusEntity = { label: string; skills: string[]; rate: number | null; location: string | null; text: string };

const parseNum = (v: any): number | null => {
  if (v == null || v === "") return null;
  const nums = (String(v).match(/\d+(\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0 && n < 10000);
  return nums.length ? Math.max(...nums) : null;
};

/** 生レコードから評価用エンティティを生成。 */
export function buildFocusEntity(table: "jobs" | "candidates", row: any): FocusEntity {
  const skills: string[] = Array.isArray(row?.skills) ? row.skills.filter(Boolean) : [];
  if (table === "jobs") {
    const rate = parseNum(row?.salary_max) ?? parseNum(row?.salary_min);
    return { label: row?.title ?? "案件", skills, rate, location: row?.work_location ?? null, text: [row?.role_label, row?.client_name, row?.detail, skills.join(" ")].filter(Boolean).join(" ") };
  }
  const rate = parseNum(row?.salary_max) ?? parseNum(row?.salary_min) ?? parseNum(row?.rate);
  return { label: row?.name ?? "人材", skills, rate, location: row?.location ?? null, text: [row?.title, row?.affiliation, skills.join(" ")].filter(Boolean).join(" ") };
}

export type FocusCheck = { label: string; pass: boolean; detail: string };
export type FocusEval = { configured: boolean; pass: boolean; checks: FocusCheck[]; note: string };

/** エンティティが注力定義に合致するか評価。未設定の条件はスキップ。 */
export function evaluateFocus(rule: FocusRule, e: FocusEntity): FocusEval {
  const checks: FocusCheck[] = [];
  const hay = `${e.label} ${e.text} ${e.skills.join(" ")}`.toLowerCase();

  if (rule.minRate != null) {
    const ok = e.rate != null && e.rate >= rule.minRate;
    checks.push({ label: `単価 ${rule.minRate}万以上`, pass: ok, detail: e.rate != null ? `${e.rate}万` : "単価不明" });
  }
  if (rule.skills.length) {
    const matched = rule.skills.filter((s) => s && hay.includes(s.toLowerCase()));
    checks.push({ label: `重視スキル（${rule.skills.join("・")}）`, pass: matched.length > 0, detail: matched.length ? `合致：${matched.join("・")}` : "該当なし" });
  }
  if (rule.keywords.length) {
    const matched = rule.keywords.filter((k) => k && hay.includes(k.toLowerCase()));
    checks.push({ label: `キーワード（${rule.keywords.join("・")}）`, pass: matched.length > 0, detail: matched.length ? `合致：${matched.join("・")}` : "該当なし" });
  }

  const configured = checks.length > 0 || !!rule.note.trim();
  const pass = checks.length === 0 ? true : checks.every((c) => c.pass);
  return { configured, pass, checks, note: rule.note ?? "" };
}

/** 文字列(カンマ/読点区切り) ⇄ 配列 */
export const splitList = (s: string): string[] => (s || "").split(/[,、\n]+/).map((x) => x.trim()).filter(Boolean);
