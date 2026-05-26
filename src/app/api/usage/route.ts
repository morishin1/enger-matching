import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { engerAdmin } from "@/lib/supabase";
import { estCostUsd } from "@/lib/llm";

export const dynamic = "force-dynamic";

/**
 * 外部AI（Gemini/GAS等）の使用量を受け取り ai_usage に記録するエンドポイント。
 *   認証: ヘッダ x-usage-token === env USAGE_INGEST_TOKEN
 *   Body: 単体 or 配列。{ provider?, feature?, model?, input_tokens?, output_tokens?, cost_usd?, created_at? }
 *   GAS から「1実行ごとに当回のトークン合計」をPOSTする想定。
 */
export async function POST(req: NextRequest) {
  const token = process.env.USAGE_INGEST_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "USAGE_INGEST_TOKEN 未設定" }, { status: 503 });
  if (req.headers.get("x-usage-token") !== token) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 }); }
  const items = Array.isArray(body) ? body : [body];

  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return NextResponse.json({ ok: false, error: "service role 未設定" }, { status: 503 }); }

  const rows = items.map((it) => {
    const input = Number(it.input_tokens) || 0;
    const output = Number(it.output_tokens) || 0;
    const model = String(it.model || "gemini-2.0-flash");
    const cost = it.cost_usd != null ? Number(it.cost_usd) : estCostUsd(model, { input, output });
    const row: Record<string, any> = {
      feature: String(it.feature || "gemini"),
      provider: String(it.provider || "google"),
      model,
      input_tokens: input,
      output_tokens: output,
      cost_usd: cost,
    };
    if (it.created_at) row.created_at = it.created_at;
    return row;
  });

  // provider 列が無い環境でも記録できるようフォールバック
  let ins: any = await admin.from("ai_usage").insert(rows, { count: "exact" });
  if (ins.error && /provider/.test(ins.error.message)) {
    ins = await admin.from("ai_usage").insert(rows.map(({ provider, ...r }) => r), { count: "exact" });
  }
  if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, inserted: ins.count ?? rows.length });
}
