import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";
import { MEETING_SENTIMENTS, MEETING_RELATIONS, MEETING_COMPETITORS, MEETING_TAGS } from "@/lib/proposal-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

/** 打ち合わせの文字起こしをAI解析し、記録フォームの項目に分解して返す。 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストが不正です" }, 400); }
  const transcript = String(body?.transcript ?? "").trim().slice(0, 12000);
  const company = String(body?.company ?? "").trim();
  if (!transcript) return json({ ok: false, error: "文字起こしテキストを貼り付けてください" }, 400);

  const system = "あなたはSES/エンジニア人材事業の営業アナリストです。商談の文字起こしを構造化し、必ず指定のJSONのみで返します。";
  const prompt = [
    company ? `相手企業: ${company}` : "",
    "以下の打ち合わせ文字起こしを分析し、次のJSONだけを出力してください（説明文やコードフェンスは不要）。",
    "{",
    '  "ai_summary": "200字程度の要約",',
    `  "fb_sentiment": ${JSON.stringify(MEETING_SENTIMENTS)} のいずれか,`,
    `  "relation_status": ${JSON.stringify(MEETING_RELATIONS)} のいずれか,`,
    '  "new_or_existing": "新規" または "既存",',
    '  "hit_points": "刺さった訴求点",',
    '  "miss_points": "響かなかった点",',
    '  "needs": "顧客の課題・ニーズ",',
    '  "strategy": "戦略的示唆（次にどう動くべきか）",',
    '  "next_action_us": "次回アクション(自社)",',
    '  "next_action_them": "次回アクション(相手)",',
    `  "competitors": ${JSON.stringify(MEETING_COMPETITORS)} の部分集合(配列),`,
    '  "competitor_detail": "競合言及の詳細",',
    `  "tags": ${JSON.stringify(MEETING_TAGS)} の部分集合(配列),`,
    "}",
    "該当が無い項目は空文字または空配列にしてください。",
    "",
    "── 文字起こし ──",
    transcript,
  ].filter(Boolean).join("\n");

  const r = await callLLM({ system, prompt, maxTokens: 900, temperature: 0.3 });
  if (!r.ok) return json({ ok: false, error: r.error }, r.status);
  await logUsage("meeting", r.model, r.usage);

  const parsed = parseJsonLoose<Record<string, any>>(r.text);
  if (!parsed) return json({ ok: false, error: "AI応答の解析に失敗しました", raw: r.text.slice(0, 400) }, 502);

  // 値の正規化（許可リストに無いものは弾く）
  const pickIn = (v: any, list: string[]) => (typeof v === "string" && list.includes(v) ? v : "");
  const arrIn = (v: any, list: string[]) => (Array.isArray(v) ? v.filter((x) => list.includes(x)) : []);
  const result = {
    ai_summary: String(parsed.ai_summary ?? ""),
    fb_sentiment: pickIn(parsed.fb_sentiment, MEETING_SENTIMENTS),
    relation_status: pickIn(parsed.relation_status, MEETING_RELATIONS),
    new_or_existing: ["新規", "既存"].includes(parsed.new_or_existing) ? parsed.new_or_existing : "",
    hit_points: String(parsed.hit_points ?? ""),
    miss_points: String(parsed.miss_points ?? ""),
    needs: String(parsed.needs ?? ""),
    strategy: String(parsed.strategy ?? ""),
    next_action_us: String(parsed.next_action_us ?? ""),
    next_action_them: String(parsed.next_action_them ?? ""),
    competitors: arrIn(parsed.competitors, MEETING_COMPETITORS),
    competitor_detail: String(parsed.competitor_detail ?? ""),
    tags: arrIn(parsed.tags, MEETING_TAGS),
  };
  return json({ ok: true, result });
}
