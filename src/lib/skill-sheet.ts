// スキルシート(職務経歴書)を AI で要約＋追加スキル抽出するサーバ専用ヘルパ。
// 取込時に1回だけ実行し、結果は candidates.skill_sheet_summary / skill_sheet_skills にキャッシュ。
// マッチング時は再フェッチせずキャッシュを参照（コスト最小化）。

import { fetchDriveFile, driveConfigured } from "./drive";
import { callLLM, callLLMVision, parseJsonLoose } from "./llm";
import { logUsage } from "./ai-usage";
import { normalizeSkills } from "./skills";

export { driveConfigured };

const SYS = "あなたはエンジニア人材の職務経歴書(スキルシート)を読み取り、JSON のみで返すアシスタントです。前置きや説明は不要。";
const PROMPT = [
  "次のスキルシートから以下を抽出して JSON のみで返してください。",
  "1) summary: 強み・職務範囲・技術領域・特筆経験を 300字以内で要約",
  "2) skills:  使用技術・フレームワーク・言語・ツールを配列で（表記は一般名・最大40件）",
  "3) years:   主要技術ごとの実務年数（例: {\"Java\": 8, \"AWS\": 3}・分かる範囲で・最大20件）",
  "形式: {\"summary\": \"…\", \"skills\": [\"…\"], \"years\": {\"…\": 数値}}",
].join("\n");

type Extracted = { summary?: string; skills?: string[]; years?: Record<string, number>; error?: string };

/** バイト列を AI に投げて要約＋スキルを抽出。テキストは text LLM、PDF/画像は vision LLM へ。 */
async function analyzeBytes(bytes: Buffer, mimeType: string): Promise<Extracted> {
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    const text = bytes.toString("utf-8").slice(0, 30000);
    const r = await callLLM({ system: SYS, prompt: `${PROMPT}\n\n--- スキルシート本文 ---\n${text}`, maxTokens: 800, temperature: 0.1 });
    if (!r.ok) return { error: r.error };
    try { await logUsage("skill-sheet", r.model, r.usage); } catch { /* noop */ }
    const p = parseJsonLoose<Extracted>(r.text);
    return p ?? { error: "JSON解析失敗" };
  }
  const visionMime = mimeType.startsWith("image/") || mimeType === "application/pdf"
    ? mimeType
    : "application/octet-stream";
  if (visionMime === "application/octet-stream") return { error: `未対応の形式: ${mimeType}` };
  const r = await callLLMVision({ system: SYS, prompt: PROMPT, files: [{ mediaType: visionMime, dataB64: bytes.toString("base64") }], maxTokens: 800 });
  if (!r.ok) return { error: r.error };
  try { await logUsage("skill-sheet", r.model, r.usage); } catch { /* noop */ }
  return parseJsonLoose<Extracted>(r.text) ?? { error: "JSON解析失敗" };
}

export type SkillSheetResult = { ok: true; summary: string; skills: string[]; years: Record<string, number> } | { ok: false; error: string };

/** Drive URL を受け取り、ファイル取得 → AI解析して構造化。失敗時もエラーで返す（呼び出し側で error列に保存）。 */
export async function analyzeSkillSheet(driveUrl: string): Promise<SkillSheetResult> {
  if (!driveConfigured()) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON 未設定（解析スキップ）" };
  const f = await fetchDriveFile(driveUrl);
  if (!f.ok) return { ok: false, error: f.error };
  const ex = await analyzeBytes(f.bytes, f.mimeType);
  if (ex.error || (!ex.summary && !ex.skills?.length)) {
    return { ok: false, error: ex.error || "要約/スキルが抽出できませんでした" };
  }
  const skills = Array.isArray(ex.skills) ? normalizeSkills(ex.skills.filter((s): s is string => typeof s === "string" && !!s.trim())) : [];
  return { ok: true, summary: (ex.summary ?? "").slice(0, 600), skills, years: ex.years ?? {} };
}
