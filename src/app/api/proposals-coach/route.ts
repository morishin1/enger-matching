import { callLLM } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";
import { currentAccess } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

// 滞留日数（提案 or ステージ更新からの経過）
function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/** 提案ボードの当日リストをAIコーチが分析し、講評・優先対応・リスク・担当者別アドバイスを返す。
 *  Haiku 固定で安価（1回 約1円）。入力は要約済みの軽量JSONのみで個人情報は最小限。 */
export async function POST(req: Request) {
  const me = await currentAccess();
  if (!me) return json({ ok: false, error: "未ログインです" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストが不正です" }, 400); }
  const rows: any[] = Array.isArray(body?.proposals) ? body.proposals : [];
  const periodLabel = String(body?.periodLabel ?? "本日");
  if (rows.length === 0) return json({ ok: false, error: "分析対象の提案がありません" }, 400);

  // LLMに渡す前に軽量化（最大60件・必要項目のみ）。氏名はイニシャル/匿名寄りに留める。
  const compact = rows.slice(0, 60).map((p) => ({
    案件: (p.job_title ?? "").slice(0, 40) || "—",
    企業: (p.company ?? "").slice(0, 24) || "—",
    人材: (p.c_init ?? p.candidate_name ?? "—"),
    ステージ: p.stage ?? "—",
    提案者: p.proposer ?? "未割当",
    CL: p.closer ?? "未割当",
    架電: p.caller_status ?? "—",
    面談: p.meeting_status ?? "—",
    スコア: p.score ?? null,
    単価: p.rate ?? null,
    滞留日数: daysSince(p.stage_updated_at ?? p.created_at),
  }));

  // 集計サマリ（件数・滞留・未架電など）をAIに渡してブレを減らす
  const total = compact.length;
  const noCaller = compact.filter((c) => /未架電|—/.test(String(c.架電))).length;
  const stale3 = compact.filter((c) => (c.滞留日数 ?? 0) >= 3).length;
  const unassignedCL = compact.filter((c) => c.CL === "未割当").length;

  const system = "あなたはSES/エンジニア人材事業の営業マネージャー（AIコーチ）です。提案管理の一覧を見て、現場がすぐ動ける具体的な講評を日本語で返します。出力は指定のJSONのみ（説明文やコードフェンスは不要）。";
  const prompt = [
    `対象期間: ${periodLabel}（提案 ${total}件）。集計: 未架電/未着手 ${noCaller}件 / 滞留3日以上 ${stale3}件 / CL未割当 ${unassignedCL}件。`,
    "以下の提案リストを分析し、次のJSONだけを出力してください。",
    "{",
    '  "headline": "全体の一言講評（40字以内）",',
    '  "summary": "状況の総評（150字程度。良い点と課題を端的に）",',
    '  "priorities": ["今すぐ着手すべき提案を最大5件。各40字以内。案件名や企業名を含め、なぜ優先かを一言で"],',
    '  "risks": ["放置リスク・取りこぼし懸念を最大4件。各40字以内"],',
    '  "by_proposer": ["提案者ごとの傾向・助言を最大4件。各40字以内（例: 藤本さんは未架電が多い→初動を優先）"],',
    '  "next_actions": ["チームの次の一手を最大4件。各30字以内"]',
    "}",
    "滞留日数が大きい・未架電・CL未割当・スコアが高いのに動いていない提案を重視してください。該当が無い配列は空でよい。",
    "",
    "── 提案リスト(JSON) ──",
    JSON.stringify(compact),
  ].join("\n");

  // Haiku 固定（安価）。env が Sonnet 等でもこの分析は Haiku を選好。
  const prev = process.env.LLM_MODEL;
  if (!prev || !/haiku/i.test(prev)) process.env.LLM_MODEL = "claude-haiku-4-5";
  const r = await callLLM({ system, prompt, maxTokens: 1100, temperature: 0.3 });
  if (prev) process.env.LLM_MODEL = prev; else delete process.env.LLM_MODEL;

  if (!r.ok) return json({ ok: false, error: r.error }, r.status);
  try { await logUsage("proposals-coach", r.model, r.usage); } catch { /* noop */ }

  const { parseJsonLoose, estCostUsd } = await import("@/lib/llm");
  const parsed = parseJsonLoose<Record<string, any>>(r.text);
  if (!parsed) return json({ ok: false, error: "AI応答の解析に失敗しました", raw: r.text.slice(0, 400) }, 502);

  const arr = (v: any): string[] => Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 6) : [];
  const result = {
    headline: String(parsed.headline ?? "").slice(0, 80),
    summary: String(parsed.summary ?? ""),
    priorities: arr(parsed.priorities),
    risks: arr(parsed.risks),
    by_proposer: arr(parsed.by_proposer),
    next_actions: arr(parsed.next_actions),
  };
  // 参考までに概算コスト（円）も返す（1ドル=155円換算）
  const costJpy = Math.round(estCostUsd(r.model, r.usage) * 155 * 100) / 100;
  return json({ ok: true, result, meta: { analyzed: total, model: r.model, costJpy } });
}
