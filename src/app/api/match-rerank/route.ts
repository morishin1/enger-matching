import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage, countTodayUsage } from "@/lib/ai-usage";
import { getSessionEmail } from "@/lib/accounts";
import { getAiCache, setAiCache } from "@/lib/ai-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI再ランキングの1日1アカウント上限（環境変数で変更可、既定3回）。
// キャッシュヒット（同じ案件の再表示）は LLM を呼ばないのでカウント対象外。
const DAILY_LIMIT = Math.max(1, Number(process.env.AI_RERANK_DAILY_LIMIT || 10));

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

// 同じ案件×候補リストで何度も課金しないための共有キャッシュ（enger.ai_cache）。
// データ（スキル・単価）が変わればキーも変わるので、古い評価が残ることはない。
type RerankResult = { candidate_no: number; score: number; reason: string };
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

  // キャッシュヒットなら LLM を呼ばず即返す（コスト0・回数カウントなし）。7日TTL（キーがデータ依存なので陳腐化しない）。
  const ckey = cacheKeyOf(job, candidates);
  const hit = await getAiCache<RerankResult[]>("rerank", ckey, 7 * 86400);
  if (hit) return json({ ok: true, results: hit, cached: true });

  // 1日1アカウント上限チェック（LLMを実際に呼ぶ＝課金が発生する手前で判定）
  let account = "";
  try { account = (await getSessionEmail()) || ""; } catch { account = ""; }
  account = account || "unknown";
  const usedToday = await countTodayUsage("rerank", account);
  if (usedToday >= DAILY_LIMIT) {
    return json({ ok: false, limited: true, error: `AI再ランキングは1日${DAILY_LIMIT}回までです。本日の上限に達しました（明日リセット）。ルール順の表示と、評価済み案件の再表示は引き続きご利用いただけます。` }, 429);
  }

  const system = "あなたはSES/エンジニア人材のマッチング専門家です。案件と候補者の適合度を、必須スキルを最優先に厳格評価し、必ず指定JSONのみで返します。";
  const jobDesc = [
    `案件: ${job.title ?? ""}`,
    job.role_label ? `職種: ${job.role_label}` : "",
    `必須スキル(抽出): ${(job.skills ?? []).join(" / ") || "—"}`,
    (job.salary_min || job.salary_max) ? `単価: ${job.salary_min ?? ""}〜${job.salary_max ?? ""}万円` : "",
    job.remote_type ? `リモート: ${job.remote_type}` : "",
    // 案件本文（必須スキル/尚可スキル/業務内容の原文）。必須・尚可・経験カテゴリの判定に使う。
    job.detail ? `案件詳細(原文・必須/尚可スキル・業務内容を含む):\n${String(job.detail).slice(0, 1600)}` : "",
  ].filter(Boolean).join("\n");
  const candList = candidates.map((c, i) => {
    const head = `${i + 1}. no=${c.candidate_no} / ${c.name ?? ""} / ${c.title ?? ""} / 経験:${c.exp ?? "—"} / 希望単価:${c.rate ?? "—"} / リモート希望:${c.remote_pref ?? "—"} / スキル:${(c.skills ?? []).join(" ")}`;
    const sum = c.skill_sheet_summary ? `\n   経歴要約: ${String(c.skill_sheet_summary).slice(0, 400)}` : "";
    return head + sum;
  }).join("\n");

  const prompt = [
    "次の案件に対して、各候補者の適合度を0〜100で採点し、JSON配列だけを出力してください（説明やコードフェンス不要）。",
    "案件詳細の原文から【必須スキル】【尚可スキル】【業務内容/経験】を読み取り、次の3軸を多重チェックして総合評価してください。",
    "",
    "■第1軸（最優先・ゲート）必須スキル：案件の必須スキル/必須要件を候補がどれだけ満たすか。",
    "  ・必須を1つでも欠く＝現場が通らない致命的ミスマッチ。必須充足率が低い候補は他がどれだけ良くても低得点に必ず抑える。",
    "  ・必須の半分未満しか満たさない → 49点以下。1/4未満 → 29点以下。必須を完全充足して初めて高得点の土俵に乗る。",
    "  ・表記揺れ/関連技術は同等とみなしてよい（例：React=React.js、k8s=Kubernetes）。ただし別カテゴリ技術での代替は不可。",
    "■第2軸 尚可スキル：案件の尚可/歓迎要件をどれだけ満たすか。必須を満たした候補同士の優先順位付けに使う（加点要素）。",
    "■第3軸 経験業務カテゴリ：案件の業務内容/領域（例：NW設計、フロント開発、インフラ運用、PM）と候補の実務経験が一致するか。",
    "  ・必須スキル名は一致しても業務カテゴリ/レイヤが異なる場合は減点（例：開発案件にインフラ専任は不適）。",
    "",
    "■単価：希望単価が案件予算を10万円超で上回る場合は現場調整不可。10〜20万超は60点以下、20万超は40点以下に抑える。",
    "  ただし『要相談/応相談/スキル見合い/空白』は交渉可のため減点しない。",
    '形式: [{"candidate_no": 数値, "score": 0-100, "reason": "必須充足・尚可・経験カテゴリに触れた30字程度の根拠"}]',
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
  await setAiCache("rerank", ckey, results);
  const remaining = Math.max(0, DAILY_LIMIT - (usedToday + 1));
  return json({ ok: true, results, cached: false, remaining, limit: DAILY_LIMIT });
}
