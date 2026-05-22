// LLM 呼び出しの共通ヘルパ（OpenAI互換 / Anthropic 自動判別）。
//   環境変数: ANTHROPIC_API_KEY または LLM_API_KEY、任意で LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL
//   サーバー専用（API ルートからのみ使用）。

export type LLMResult = { ok: true; text: string } | { ok: false; status: number; error: string };

export async function callLLM(opts: { system: string; prompt: string; maxTokens?: number; temperature?: number }): Promise<LLMResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.LLM_API_KEY;
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();
  const modelEnv = process.env.LLM_MODEL || "";
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
      return text ? { ok: true, text } : { ok: false, status: 502, error: "空の応答" };
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
    return text ? { ok: true, text } : { ok: false, status: 502, error: "空の応答" };
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
