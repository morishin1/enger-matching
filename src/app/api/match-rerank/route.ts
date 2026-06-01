import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage, countTodayUsage } from "@/lib/ai-usage";
import { getSessionEmail } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI再ランキングの1日1アカウント上限（環境変数で変更可、既定3回）。
// キャッシュヒット（同じ案件の再表示）は LLM を呼ばないのでカウント対象外。
const DAILY_LIMIT = Math.max(1, Number(process.env.AI_RERANK_DAILY_LIMIT || 10));

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

// 同じ案件×候補リストで何度も課金しないためのインメモリキャッシュ（提案メール生成と同方式）。
// データ（スキル・単価）が変わればキーも変わるので、古い評価が残ることはない。
const cache = new Map<string, { candidate_no: number; score: number; reason: string }[]>();
const cacheKeyOf = (job: any, cands: any[]) => {
  const j = [job?.title, (job?.skills ?? []).join(","), job?.salary_min, job?.salary_max, job?.remote_type, job?.role_label].join("|");
  const c = cands.map((c) => `${c.candidate_no}:${c.rate ?? ""}:${(c.skills ?? []).join("/")}`).join(";");
  return `${j}#${c}`;
};

/** ルールベース上位の候補を、LLMで文脈評価して再ランキング（適合度＋理由）。 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストが不正です" }, 400); }
  const job = body?.job ?? {};
  const candidates: any[] = Array.isArray(body?.candidates) ? body.candidates.slice(0, 10) : [];
  if (!candidates.length) return json({ ok: false, error: "候補がありません" }, 400);

  // キャッシュヒットなら LLM を呼ばず即返す（コスト0・回数カウントなし）
  const ckey = cacheKeyOf(job, candidates);
  const hit = cache.get(ckey);
  if (hit) return json({ ok: true, results: hit, cached: true });

  // 1日1アカウント上限チェック（LLMを実際に呼ぶ＝課金が発生する手前で判定）
  let account = "";
  try { account = (await getSessionEmail()) || ""; } catch { account = ""; }
  account = account || "unknown";
  const usedToday = await countTodayUsage("rerank", account);
  if (usedToday >= DAILY_LIMIT) {
    return json({ ok: false, limited: true, error: `AI再ランキングは1日${DAILY_LIMIT}回までです。本日の上限に達しました（明日リセット）。ルール順の表示と、評価済み案件の再表示は引き続きご利用いただけます。` }, 429);
  }

  const system = "あなたはSES/エンジニア人材のマッチング専門家です。案件と候補者の適合度を文脈から評価し、必ず指定JSONのみで返します。";
  const jobDesc = [
    `案件: ${job.title ?? ""}`,
    job.role_label ? `職種: ${job.role_label}` : "",
    `必要スキル: ${(job.skills ?? []).join(" / ") || "—"}`,
    (job.salary_min || job.salary_max) ? `単価: ${job.salary_min ?? ""}〜${job.salary_max ?? ""}万円` : "",
    job.remote_type ? `リモート: ${job.remote_type}` : "",
  ].filter(Boolean).join("\n");
  const candList = candidates.map((c, i) => {
    const head = `${i + 1}. no=${c.candidate_no} / ${c.name ?? ""} / ${c.title ?? ""} / 経験:${c.exp ?? "—"} / 希望単価:${c.rate ?? "—"} / リモート希望:${c.remote_pref ?? "—"} / スキル:${(c.skills ?? []).join(" ")}`;
    const sum = c.skill_sheet_summary ? `\n   経歴要約: ${String(c.skill_sheet_summary).slice(0, 400)}` : "";
    return head + sum;
  }).join("\n");

  const prompt = [
    "次の案件に対して、各候補者の適合度を0〜100で採点し、JSON配列だけを出力してください（説明やコードフェンス不要）。",
    "スキルの類似(表記揺れ・関連技術)、単価整合、職種・リモート条件、経験年数の妥当性を総合評価してください。",
    "重要: 単価が案件予算を10万円超で上回る場合は現場で調整できずミスマッチ。スキルが完全一致でも、",
    "予算超過10〜20万は60点以下、20万超(例:40万差)は40点以下に必ず抑えてください。予算内なら通常評価。",
    "ただし希望単価が『要相談/応相談/スキル見合い/空白』など数値で判断できない場合は、交渉で調整できるため減点せず上位寄りに評価してください。",
    '形式: [{"candidate_no": 数値, "score": 0-100, "reason": "30字程度の根拠"}]',
    "",
    "── 案件 ──",
    jobDesc,
    "",
    "── 候補者 ──",
    candList,
  ].join("\n");

  const r = await callLLM({ system, prompt, maxTokens: 900, temperature: 0.2 });
  if (!r.ok) return json({ ok: false, error: r.error }, r.status);
  await logUsage("rerank", r.model, r.usage, account);
  const parsed = parseJsonLoose<any[]>(r.text);
  if (!Array.isArray(parsed)) return json({ ok: false, error: "AI応答の解析に失敗しました", raw: r.text.slice(0, 300) }, 502);

  const valid = new Set(candidates.map((c) => Number(c.candidate_no)));
  const results = parsed
    .map((p) => ({ candidate_no: Number(p.candidate_no), score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))), reason: String(p.reason ?? "") }))
    .filter((p) => valid.has(p.candidate_no));
  // 結果をキャッシュ（メモリ肥大を防ぐため簡易上限）
  if (cache.size > 500) cache.clear();
  cache.set(ckey, results);
  const remaining = Math.max(0, DAILY_LIMIT - (usedToday + 1));
  return json({ ok: true, results, cached: false, remaining, limit: DAILY_LIMIT });
}
