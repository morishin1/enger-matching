// 提案送信前のスキル多重チェック API（L2: AI ファイナル監査）。
//   ・案件×候補1人に対して、①必須スキル ②尚可スキル ③経験業務カテゴリ の3軸を LLM が監査
//   ・各必須スキルには「候補側のどこに根拠があるか（経歴/PR/スキルシート要約 等の引用）」を要求
//   ・根拠ゼロの必須スキルがあれば営業に明示し、送信前に確認させる（送信ブロックは UI 側で判断）
//   ・ペア単位でインメモリキャッシュ。1日上限は AI_PRECHECK_DAILY_LIMIT（既定 30/アカウント）。
//
// 既存の /api/match-rerank（上位10件の再ランキング）とは目的が異なる:
//   rerank   = 候補10名の順位付け（上位10件・1回のLLM）
//   precheck = 提案1人の根拠付き監査（個別ペア・送信前のラストチェック）

import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage, countTodayUsage } from "@/lib/ai-usage";
import { getSessionEmail } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAILY_LIMIT = Math.max(1, Number(process.env.AI_PRECHECK_DAILY_LIMIT || 30));

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

// プロセス内キャッシュ（同じ案件×人材の組合せで再課金しないため）。
// 案件本文・人材スキル/PR が変われば自動的に新キーになるので古い監査は残らない。
type FindingItem = { skill: string; found: boolean; evidence: string };
type PrecheckResult = {
  overall: "ok" | "warn" | "block";
  required: FindingItem[];
  preferred: FindingItem[];
  category: { match: boolean; reason: string };
  summary: string;
};
const cache = new Map<string, PrecheckResult>();
const keyOf = (job: any, cand: any) => {
  const j = [job?.title, (job?.skills ?? []).join(","), String(job?.detail ?? "").slice(0, 800)].join("|");
  const c = [cand?.candidate_no, (cand?.skills ?? []).join(","), String(cand?.exp ?? "").slice(0, 400), String(cand?.note ?? "").slice(0, 400), String(cand?.skill_sheet_summary ?? "").slice(0, 400)].join("|");
  return `${j}#${c}`;
};

const SYSTEM = `あなたはSES/エンジニア人材のマッチング監査担当です。
案件と候補1名のペアに対し、提案送信の直前チェックとして「①必須スキル ②尚可スキル ③経験業務カテゴリ」の3軸を厳格に評価します。
各必須スキルは候補のテキスト（経歴/PR/職種/会社/スキルシート要約 等）に根拠があるかを必ず確認し、根拠の引用（最大80字）を返します。
根拠が無い必須スキルは見逃すと現場が通らない致命傷になるため、必ず found=false としてください。
出力は指定の JSON のみ（前置きや説明・コードフェンス不要）。`;

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストが不正です" }, 400); }
  const job = body?.job ?? {};
  const cand = body?.cand ?? {};
  const jobSkills: string[] = Array.isArray(job?.skills) ? job.skills.filter(Boolean) : [];
  if (!cand || (!cand.candidate_no && !cand.name)) return json({ ok: false, error: "候補情報がありません" }, 400);

  const key = keyOf(job, cand);
  const hit = cache.get(key);
  if (hit) return json({ ok: true, result: hit, cached: true });

  let account = "";
  try { account = (await getSessionEmail()) || ""; } catch { account = ""; }
  account = account || "unknown";
  const usedToday = await countTodayUsage("precheck", account);
  if (usedToday >= DAILY_LIMIT) {
    return json({ ok: false, limited: true, error: `提案前チェック（AI）は1日${DAILY_LIMIT}回までです。本日の上限に達しました（明日リセット）。` }, 429);
  }

  const candText = [
    cand.title ? `職種: ${cand.title}` : "",
    cand.company ? `所属会社: ${cand.company}` : "",
    Array.isArray(cand.skills) && cand.skills.length ? `登録スキル: ${cand.skills.join(" / ")}` : "登録スキル: —",
    cand.exp ? `経験/実績(原文):\n${String(cand.exp).slice(0, 1400)}` : "",
    cand.note ? `備考/PR(原文):\n${String(cand.note).slice(0, 1000)}` : "",
    cand.skill_sheet_summary ? `スキルシート要約:\n${String(cand.skill_sheet_summary).slice(0, 800)}` : "",
    cand.rate ? `希望単価: ${cand.rate}` : "",
  ].filter(Boolean).join("\n");
  const jobText = [
    `案件名: ${job.title ?? "—"}`,
    job.role_label ? `職種: ${job.role_label}` : "",
    jobSkills.length ? `必須スキル(抽出): ${jobSkills.join(" / ")}` : "必須スキル(抽出): —",
    job.salary_label ? `単価: ${job.salary_label}` : "",
    job.detail ? `案件詳細(原文・必須/尚可スキル・業務内容を含む):\n${String(job.detail).slice(0, 1800)}` : "",
  ].filter(Boolean).join("\n");

  const prompt = [
    "以下の案件×候補1名について、提案送信の直前監査を行ってください。",
    "",
    "■第1軸（最優先・ゲート）必須スキル：案件の必須スキル1つずつについて、候補テキスト（登録スキル/経歴/PR/職種/会社/スキルシート要約）の中に根拠があるかを判定し、根拠を最大80字で引用してください。根拠が無いものは found=false。表記揺れ・同義語（React=React.js / k8s=Kubernetes 等）は同等とみなしてよい。別カテゴリ技術での代替は不可（例：Java を Python で代替しない）。",
    "■第2軸 尚可スキル：案件詳細の【尚可/向可/歓迎】セクションの要件を、候補テキストに照らして該当があるか列挙してください。明確な該当が無ければ found=false。",
    "■第3軸 経験業務カテゴリ：案件の業務カテゴリ（例: NW設計 / フロント開発 / インフラ運用 / PM）と、候補の実務経験のカテゴリが一致するかを判定し、reason に短く根拠を書いてください。",
    "",
    "■overall:",
    "  - block: 必須スキルに根拠ゼロが1つ以上ある（土俵に乗らない）",
    "  - warn:  必須は全て根拠あるが、尚可/カテゴリで懸念がある",
    "  - ok:    すべての観点で問題なし",
    "",
    '形式: {"overall":"ok|warn|block","required":[{"skill":"...","found":true|false,"evidence":"..."}],"preferred":[{"skill":"...","found":true|false,"evidence":"..."}],"category":{"match":true|false,"reason":"..."},"summary":"営業向けに要点を60字程度"}',
    "",
    "── 案件 ──",
    jobText,
    "",
    "── 候補 ──",
    candText,
  ].join("\n");

  const r = await callLLM({ system: SYSTEM, prompt, maxTokens: 900, temperature: 0.2 });
  if (!r.ok) return json({ ok: false, error: r.error }, r.status);
  await logUsage("precheck", r.model, r.usage, account);
  const parsed = parseJsonLoose<any>(r.text);
  if (!parsed || typeof parsed !== "object") return json({ ok: false, error: "AI応答の解析に失敗しました", raw: r.text.slice(0, 300) }, 502);

  const asItem = (v: any): FindingItem | null => {
    if (!v || typeof v !== "object") return null;
    const skill = String(v.skill ?? "").trim();
    if (!skill) return null;
    return { skill, found: !!v.found, evidence: String(v.evidence ?? "").slice(0, 160) };
  };
  const arr = (v: any): FindingItem[] => Array.isArray(v) ? v.map(asItem).filter((x): x is FindingItem => !!x) : [];

  const result: PrecheckResult = {
    overall: parsed.overall === "block" ? "block" : parsed.overall === "warn" ? "warn" : "ok",
    required: arr(parsed.required),
    preferred: arr(parsed.preferred),
    category: { match: !!parsed?.category?.match, reason: String(parsed?.category?.reason ?? "").slice(0, 160) },
    summary: String(parsed.summary ?? "").slice(0, 160),
  };
  // 自前ゲート：必須スキルで found=false が含まれているなら overall を必ず block にする
  if (result.required.some((x) => !x.found)) result.overall = "block";
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return json({ ok: true, result, cached: false, remaining: Math.max(0, DAILY_LIMIT - (usedToday + 1)), limit: DAILY_LIMIT });
}
