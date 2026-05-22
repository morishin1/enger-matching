// 提案メール本文の LLM 生成 API（激安モデル・クリック時のみ・結果キャッシュ）。
//   OpenAI互換 と Anthropic(Claude) の両対応。プロバイダは自動判別。
//   環境変数（未設定なら 503 を返し、UI 側はコピペ方式にフォールバック）:
//     LLM_API_KEY      … APIキー（OpenAI互換用）。Claude は ANTHROPIC_API_KEY でも可
//     ANTHROPIC_API_KEY… Claude のキー（あればこちらを優先しClaudeを使用）
//     LLM_PROVIDER     … "anthropic" | "openai"（省略時はキー/モデルから自動判別）
//     LLM_MODEL        … モデル名（OpenAI既定 gpt-4o-mini / Claude既定 claude-3-5-haiku-latest）
//     LLM_BASE_URL     … OpenAI互換エンドポイント（既定 https://api.openai.com/v1）

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = "あなたは優秀なSES営業担当です。丁寧で簡潔な日本語のビジネスメールを書きます。";

// プロセス内キャッシュ（同一プロンプトの再課金を防ぐ）
const cache = new Map<string, string>();

export async function POST(req: Request) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.LLM_API_KEY;
  const explicit = (process.env.LLM_PROVIDER || "").toLowerCase();
  const modelEnv = process.env.LLM_MODEL || "";

  // プロバイダ判別
  const useAnthropic =
    explicit === "anthropic" ||
    (!explicit && (!!anthropicKey || /claude/i.test(modelEnv)) && !(explicit === "openai"));

  const apiKey = useAnthropic ? (anthropicKey || openaiKey) : (openaiKey || anthropicKey);
  if (!apiKey) {
    return Response.json({ ok: false, error: "APIキー未設定（コピペ方式をご利用ください）" }, { status: 503 });
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").slice(0, 4000);
  } catch {
    return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 });
  }
  if (!prompt) return Response.json({ ok: false, error: "prompt がありません" }, { status: 400 });

  const cacheKey = `${useAnthropic ? "a" : "o"}:${modelEnv}:${prompt}`;
  if (cache.has(cacheKey)) return Response.json({ ok: true, text: cache.get(cacheKey), cached: true });

  try {
    let text = "";
    if (useAnthropic) {
      const model = modelEnv || "claude-3-5-haiku-latest";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model, max_tokens: 600, system: SYSTEM,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json({ ok: false, error: `Claude エラー (${res.status}) ${t.slice(0, 200)}` }, { status: 502 });
      }
      const data = await res.json();
      text = (data?.content?.map((b: any) => b?.text ?? "").join("") ?? "").trim();
    } else {
      const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
      const model = modelEnv || "gpt-4o-mini";
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model, temperature: 0.5, max_tokens: 500,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return Response.json({ ok: false, error: `LLM エラー (${res.status}) ${t.slice(0, 200)}` }, { status: 502 });
      }
      const data = await res.json();
      text = (data?.choices?.[0]?.message?.content ?? "").trim();
    }

    if (!text) return Response.json({ ok: false, error: "空の応答" }, { status: 502 });
    cache.set(cacheKey, text);
    return Response.json({ ok: true, text });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
