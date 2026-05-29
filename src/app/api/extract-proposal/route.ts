// 提案管理「新規追加」モーダル用：LINE/書面/メール等の生テキストを構造化フィールドに自動抽出。
//   OpenAI互換 と Anthropic(Claude) の両対応（callLLM が自動判別）。
import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `あなたはSES営業の案件・人材情報を構造化するアシスタントです。
ユーザーが貼り付けたテキスト（LINE・書面・メールなど）から、案件と人材の情報を抽出して **JSON のみ** を返してください。
分からない項目は null で。説明文や前置きは書かず、JSON だけを返します。

スキーマ:
{
  "job_title": string | null,          // 案件名・職務概要
  "client_name": string | null,        // クライアント企業名（株式会社○○ 等）
  "stage": "未対応"|"提案中"|"面談調整"|"クロージング中"|"面談合格"|null,
  "meeting_date": string | null,       // 面談予定日 YYYY/MM/DD
  "cand_name": string | null,          // 人材の氏名 or イニシャル
  "cand_company": string | null,       // 人材の所属会社
  "cand_rate": string | null,          // 希望単価 例: 80万 / ¥70〜90万
  "proposer": string | null,           // 提案者
  "partner": string | null,            // パートナー（提案2人組の相方）
  "closer": string | null,             // クロージング担当
  "client_contact": string | null,     // 企業担当者
  "note": string | null                // 補足・次アクション・備考
}`;

export async function POST(req: Request) {
  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 8000);
  } catch {
    return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 });
  }
  if (!text.trim()) return Response.json({ ok: false, error: "text がありません" }, { status: 400 });

  const r = await callLLM({ system: SYSTEM, prompt: `以下のテキストから JSON を抽出してください。\n\n---\n${text}\n---`, maxTokens: 800, temperature: 0.2 });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: r.status });
  await logUsage("extract-proposal", r.model, r.usage);

  const data = parseJsonLoose<Record<string, string | null>>(r.text);
  if (!data || typeof data !== "object") return Response.json({ ok: false, error: "AIの応答を解析できませんでした", raw: r.text }, { status: 502 });
  return Response.json({ ok: true, data });
}
