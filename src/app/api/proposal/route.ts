// 提案メール本文の LLM 生成 API（激安モデル・クリック時のみ・結果キャッシュ）。
//   OpenAI互換 と Anthropic(Claude) の両対応（callLLM が自動判別）。
//   環境変数: ANTHROPIC_API_KEY または LLM_API_KEY、任意で LLM_MODEL(=CLAUDE_MODEL) 等。

import { callLLM } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = "あなたは優秀なSES営業担当です。丁寧で簡潔な日本語のビジネスメールを書きます。";

// プロセス内キャッシュ（同一プロンプトの再課金を防ぐ）
const cache = new Map<string, string>();

export async function POST(req: Request) {
  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").slice(0, 4000);
  } catch {
    return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 });
  }
  if (!prompt) return Response.json({ ok: false, error: "prompt がありません" }, { status: 400 });

  if (cache.has(prompt)) return Response.json({ ok: true, text: cache.get(prompt), cached: true });

  const r = await callLLM({ system: SYSTEM, prompt, maxTokens: 600, temperature: 0.5 });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: r.status });

  await logUsage("proposal", r.model, r.usage);
  cache.set(prompt, r.text);
  return Response.json({ ok: true, text: r.text });
}
