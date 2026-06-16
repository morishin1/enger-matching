import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage, countTodayUsage } from "@/lib/ai-usage";
import { getSessionEmail } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI再ランキング（人材→案件）の1日1アカウント上限。案件→人材側と同じ "rerank" 枠を共有する。
const DAILY_LIMIT = Math.max(1, Number(process.env.AI_RERANK_DAILY_LIMIT || 10));

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

// 同じ人材×案件リストで何度も課金しないためのインメモリキャッシュ（案件→人材側と同方式）。
const cache = new Map<string, { job_no: number; score: number; reason: string }[]>();
const cacheKeyOf = (cand: any, jobs: any[]) => {
  const c = [cand?.name, (cand?.skills ?? []).join(","), cand?.rate, cand?.remote_pref, cand?.title].join("|");
  const j = jobs.map((j) => `${j.job_no}:${j.salary_min ?? ""}-${j.salary_max ?? ""}:${(j.skills ?? []).join("/")}`).join(";");
  return `${c}#${j}`;
};

/** ルールベース上位の案件を、LLMで文脈評価して再ランキング（人材→案件）。 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストが不正です" }, 400); }
  const cand = body?.candidate ?? {};
  const jobs: any[] = Array.isArray(body?.jobs) ? body.jobs.slice(0, 10) : [];
  if (!jobs.length) return json({ ok: false, error: "案件がありません" }, 400);

  // キャッシュヒットなら LLM を呼ばず即返す（コスト0・回数カウントなし）
  const ckey = cacheKeyOf(cand, jobs);
  const hit = cache.get(ckey);
  if (hit) return json({ ok: true, results: hit, cached: true });

  // 1日1アカウント上限チェック（LLMを実際に呼ぶ＝課金が発生する手前で判定）
  let account = "";
  try { account = (await getSessionEmail()) || ""; } catch { account = ""; }
  account = account || "unknown";
  const usedToday = await countTodayUsage("rerank", account);
  if (usedToday >= DAILY_LIMIT) {
    return json({ ok: false, limited: true, error: `AI再ランキングは1日${DAILY_LIMIT}回までです。本日の上限に達しました（明日リセット）。ルール順の表示と、評価済みの再表示は引き続きご利用いただけます。` }, 429);
  }

  const system = "あなたはSES/エンジニア人材のマッチング専門家です。人材と案件の適合度を文脈から評価し、必ず指定JSONのみで返します。";
  const candDesc = [
    `人材: ${cand.name ?? ""}`,
    cand.title ? `職種: ${cand.title}` : "",
    `保有スキル: ${(cand.skills ?? []).join(" / ") || "—"}`,
    cand.rate ? `希望単価: ${cand.rate}` : "",
    cand.exp ? `経験: ${cand.exp}` : "",
    cand.remote_pref ? `リモート希望: ${cand.remote_pref}` : "",
    cand.skill_sheet_summary ? `経歴要約: ${String(cand.skill_sheet_summary).slice(0, 400)}` : "",
  ].filter(Boolean).join("\n");
  const jobListText = jobs.map((j, i) => {
    const head = `${i + 1}. no=${j.job_no} / ${j.title ?? ""} / ${j.client_name ?? ""} / 職種:${j.role_label ?? "—"} / 単価:${j.salary_min ?? ""}〜${j.salary_max ?? ""}万円 / リモート:${j.remote_type ?? "—"} / 必須スキル:${(j.skills ?? []).join(" ")}`;
    const detail = j.detail ? `\n   案件詳細(必須/尚可スキル・業務内容):${String(j.detail).slice(0, 800)}` : "";
    return head + detail;
  }).join("\n");

  const prompt = [
    "次の人材に対して、各案件の適合度を0〜100で採点し、JSON配列だけを出力してください（説明やコードフェンス不要）。",
    "各案件詳細から【必須スキル】【尚可スキル】【業務内容/経験】を読み取り、次の3軸を多重チェックして評価してください。",
    "",
    "■第1軸（最優先・ゲート）必須スキル：案件の必須要件を人材が満たすか。",
    "  ・必須を1つでも欠く＝現場が通らない致命的ミスマッチ。必須充足が低い案件は低得点に必ず抑える。",
    "  ・必須の半分未満 → 49点以下、1/4未満 → 29点以下。必須を完全充足して初めて高得点。",
    "  ・表記揺れ/関連技術は同等可（React=React.js等）。別カテゴリ技術での代替は不可。",
    "■第2軸 尚可スキル：尚可/歓迎要件の充足（必須を満たした案件同士の優先順位付け・加点）。",
    "■第3軸 経験業務カテゴリ：案件の業務領域（NW設計/フロント/インフラ/PM等）と人材の実務経験の一致。",
    "  ・スキル名が一致しても業務カテゴリ/レイヤが違えば減点。",
    "",
    "■単価：人材の希望単価が案件予算を10万円超で上回る場合は現場調整不可。10〜20万超は60点以下、20万超は40点以下。",
    "  ただし『要相談/応相談/スキル見合い/空白』は減点しない。",
    '形式: [{"job_no": 数値, "score": 0-100, "reason": "必須充足・尚可・経験カテゴリに触れた30字程度の根拠"}]',
    "",
    "── 人材 ──",
    candDesc,
    "",
    "── 案件 ──",
    jobListText,
  ].join("\n");

  const r = await callLLM({ system, prompt, maxTokens: 900, temperature: 0.2 });
  if (!r.ok) return json({ ok: false, error: r.error }, r.status);
  await logUsage("rerank", r.model, r.usage, account);
  const parsed = parseJsonLoose<any[]>(r.text);
  if (!Array.isArray(parsed)) return json({ ok: false, error: "AI応答の解析に失敗しました", raw: r.text.slice(0, 300) }, 502);

  const valid = new Set(jobs.map((j) => Number(j.job_no)));
  const results = parsed
    .map((p) => ({ job_no: Number(p.job_no), score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))), reason: String(p.reason ?? "") }))
    .filter((p) => valid.has(p.job_no));
  if (cache.size > 500) cache.clear();
  cache.set(ckey, results);
  const remaining = Math.max(0, DAILY_LIMIT - (usedToday + 1));
  return json({ ok: true, results, cached: false, remaining, limit: DAILY_LIMIT });
}
