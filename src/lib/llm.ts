// LLM 呼び出しの共通ヘルパ（OpenAI互換 / Anthropic 自動判別）。
//   環境変数: ANTHROPIC_API_KEY または LLM_API_KEY、任意で LLM_PROVIDER / LLM_MODEL(=CLAUDE_MODEL) / LLM_BASE_URL
//   サーバー専用（API ルートからのみ使用）。

export type Usage = { input: number; output: number };
export type LLMResult =
  | { ok: true; text: string; model: string; usage: Usage }
  | { ok: false; status: number; error: string };

// 概算単価（USD / 100万トークン）。モデル名の部分一致で判定。正確な単価は各社の料金ページで確認。
const PRICES: { match: RegExp; in: number; out: number }[] = [
  { match: /haiku-4|haiku4/i, in: 1.0, out: 5.0 },
  { match: /3-5-haiku|3\.5-haiku|haiku/i, in: 0.8, out: 4.0 },
  { match: /sonnet/i, in: 3.0, out: 15.0 },
  { match: /opus/i, in: 15.0, out: 75.0 },
  { match: /4o-mini|4\.1-mini|gpt-5-mini|mini/i, in: 0.15, out: 0.6 },
  { match: /gpt-4o|gpt-4\.1|gpt-5/i, in: 2.5, out: 10.0 },
];
export function estCostUsd(model: string, u: Usage): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? { in: 1.0, out: 5.0 };
  return (u.input / 1e6) * p.in + (u.output / 1e6) * p.out;
}

export async function callLLM(opts: { system: string; prompt: string; maxTokens?: number; temperature?: number }): Promise<LLMResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.LLM_API_KEY;
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();
  const modelEnv = process.env.LLM_MODEL || process.env.CLAUDE_MODEL || "";
  const useAnthropic = explicit === "anthropic" || (!explicit && (!!anthropicKey || /claude/i.test(modelEnv)));
  const apiKey = useAnthropic ? (anthropicKey || openaiKey) : (openaiKey || anthropicKey);
  if (!apiKey) return { ok: false, status: 503, error: "APIキー未設定（ANTHROPIC_API_KEY か LLM_API_KEY を設定してください）" };

  const maxTokens = opts.maxTokens ?? 700;
  try {
    if (useAnthropic) {
      const model = modelEnv || "claude-3-5-haiku-latest";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: opts.system, messages: [{ role: "user", content: opts.prompt }] }),
      });
      if (!res.ok) return { ok: false, status: 502, error: `Claude エラー (${res.status})` };
      const data = await res.json();
      const text = (data?.content?.map((b: any) => b?.text ?? "").join("") ?? "").trim();
      const usage = { input: data?.usage?.input_tokens ?? 0, output: data?.usage?.output_tokens ?? 0 };
      return text ? { ok: true, text, model, usage } : { ok: false, status: 502, error: "空の応答" };
    }
    const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = modelEnv || "gpt-4o-mini";
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: opts.temperature ?? 0.4, max_tokens: maxTokens, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.prompt }] }),
    });
    if (!res.ok) return { ok: false, status: 502, error: `LLM エラー (${res.status})` };
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
    const usage = { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 };
    return text ? { ok: true, text, model, usage } : { ok: false, status: 502, error: "空の応答" };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 画像/PDF を読み取れる LLM 呼び出し（勤怠表のOCR・集計など）。
 *  - Anthropic: 画像(image/*) と PDF(application/pdf) に対応
 *  - OpenAI互換: 画像のみ対応（PDFは不可）
 */
export async function callLLMVision(opts: { system: string; prompt: string; files: { mediaType: string; dataB64: string }[]; maxTokens?: number }): Promise<LLMResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.LLM_API_KEY;
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();
  const modelEnv = process.env.LLM_MODEL || process.env.CLAUDE_MODEL || "";
  const useAnthropic = explicit === "anthropic" || (!explicit && (!!anthropicKey || /claude/i.test(modelEnv)));
  const apiKey = useAnthropic ? (anthropicKey || openaiKey) : (openaiKey || anthropicKey);
  if (!apiKey) return { ok: false, status: 503, error: "APIキー未設定（ANTHROPIC_API_KEY か LLM_API_KEY を設定してください）" };
  const maxTokens = opts.maxTokens ?? 600;

  try {
    if (useAnthropic) {
      // 画像/PDF 入力に対応した既定モデル（Vision 必須なので haiku ではなく sonnet を既定に）
      const model = modelEnv && !/haiku/i.test(modelEnv) ? modelEnv : "claude-3-5-sonnet-latest";
      const content: any[] = [{ type: "text", text: opts.prompt }];
      for (const f of opts.files) {
        if (f.mediaType === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: f.mediaType, data: f.dataB64 } });
        else content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.dataB64 } });
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: opts.system, messages: [{ role: "user", content }] }),
      });
      if (!res.ok) return { ok: false, status: 502, error: `Claude エラー (${res.status})` };
      const data = await res.json();
      const text = (data?.content?.map((b: any) => b?.text ?? "").join("") ?? "").trim();
      const usage = { input: data?.usage?.input_tokens ?? 0, output: data?.usage?.output_tokens ?? 0 };
      return text ? { ok: true, text, model, usage } : { ok: false, status: 502, error: "空の応答" };
    }
    // OpenAI互換（画像のみ）
    const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = modelEnv || "gpt-4o-mini";
    const content: any[] = [{ type: "text", text: opts.prompt }];
    for (const f of opts.files) {
      if (f.mediaType.startsWith("image/")) content.push({ type: "image_url", image_url: { url: `data:${f.mediaType};base64,${f.dataB64}` } });
    }
    if (content.length === 1) return { ok: false, status: 415, error: "この形式（PDF等）はOpenAIでは読み取れません。画像/CSVをご利用ください。" };
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: opts.system }, { role: "user", content }] }),
    });
    if (!res.ok) return { ok: false, status: 502, error: `LLM エラー (${res.status})` };
    const data = await res.json();
    const text = (data?.choices?.[0]?.message?.content ?? "").trim();
    const usage = { input: data?.usage?.prompt_tokens ?? 0, output: data?.usage?.completion_tokens ?? 0 };
    return text ? { ok: true, text, model, usage } : { ok: false, status: 502, error: "空の応答" };
  } catch (e) {
    return { ok: false, status: 500, error: e instanceof Error ? e.message : String(e) };
  }
}

/** ```json ... ``` などを剥がして JSON.parse する。 */
export function parseJsonLoose<T = any>(text: string): T | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try { return JSON.parse(s) as T; } catch { return null; }
}
