// 提案メール本文の LLM 生成 API（激安モデル・クリック時のみ・結果キャッシュ）。
//   環境変数（未設定なら 503 を返し、UI 側はコピペ方式にフォールバック）:
//     LLM_API_KEY   … APIキー（必須）
//     LLM_BASE_URL  … OpenAI互換エンドポイント（既定 https://api.openai.com/v1）
//     LLM_MODEL     … モデル名（既定 gpt-4o-mini = 激安）

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// プロセス内キャッシュ（同一プロンプトの再課金を防ぐ）
const cache = new Map<string, string>();

export async function POST(req: Request) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "LLM_API_KEY 未設定（コピペ方式をご利用ください）" }, { status: 503 });
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").slice(0, 4000);
  } catch {
    return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 });
  }
  if (!prompt) return Response.json({ ok: false, error: "prompt がありません" }, { status: 400 });

  if (cache.has(prompt)) return Response.json({ ok: true, text: cache.get(prompt), cached: true });

  const baseUrl = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 500,
        messages: [
          { role: "system", content: "あなたは優秀なSES営業担当です。丁寧で簡潔な日本語のビジネスメールを書きます。" },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return Response.json({ ok: false, error: `LLM エラー (${res.status}) ${t.slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return Response.json({ ok: false, error: "空の応答" }, { status: 502 });
    cache.set(prompt, text);
    return Response.json({ ok: true, text });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
