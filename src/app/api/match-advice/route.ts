// 提案前アドバイス生成 API（激安モデル・結果キャッシュ）。
//   案件×人材ペアについて「提案前に必ず確認すべき点」と「刺さる推し材料」を
//   短い箇条書きで返す。決定論的な notes（match.ts）を入力に、営業視点で要点化する。
//   コスト管理：プロセス内キャッシュ（jobNo-candNo 単位）で再課金を防ぐ。

import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `あなたはSES/エンジニア紹介の優秀な営業マネージャーです。
案件と人材のマッチング情報をもとに、営業担当が「提案する前に確認・準備すべきこと」を端的に助言します。
出力は JSON のみ（前置き・コードフェンス不要）：
{"confirm":["提案前に必ず確認すべき点を最大3件・各40字以内"],"strength":["この人材を推すときに刺さる強み・材料を最大3件・各40字以内"]}
注意:
- confirm は「単価交渉の余地」「国籍要件」「稼働時期のズレ」「商流の確認」など、見落とすと失注/手戻りになる点を優先。
- 既に🟢で問題ない点は confirm に入れない。🔴🟡の点を中心に。
- strength は必須スキル一致・業界経験・即稼働・マージンの良さなど、提案を後押しする事実のみ。創作しない。
- 該当が無ければ空配列。`;

const cache = new Map<string, { confirm: string[]; strength: string[] }>();

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 }); }

  const jobNo = body?.jobNo ?? "";
  const candNo = body?.candNo ?? "";
  const key = `${jobNo}-${candNo}`;
  if (key !== "-" && cache.has(key)) return Response.json({ ok: true, ...cache.get(key), cached: true });

  const job = body?.job ?? {};
  const cand = body?.cand ?? {};
  const notes: { level: string; text: string }[] = Array.isArray(body?.notes) ? body.notes : [];
  const score = body?.score ?? null;
  const verdict = body?.verdict ?? null;

  const noteLines = notes
    .map((n) => `${n.level === "red" ? "🔴" : n.level === "yellow" ? "🟡" : "🟢"} ${n.text}`)
    .join("\n");

  const prompt = [
    `【案件】${job.title ?? "—"}`,
    `必須スキル: ${(job.skills ?? []).join(" / ") || "—"}`,
    `単価: ${job.salary_label ?? "—"} / リモート: ${job.remote_type ?? "—"} / 商流: ${job.flow_note ?? "—"}`,
    ``,
    `【人材】${cand.title ?? "—"}`,
    `スキル: ${(cand.skills ?? []).join(" / ") || "—"}`,
    `希望単価: ${cand.rate ?? "—"} / 国籍: ${cand.nationality ?? "不明"} / 年代: ${cand.age_band ?? "—"} / 稼働: ${cand.avail ?? "—"} / リモート希望: ${cand.remote_pref ?? "—"}`,
    ``,
    `【マッチ度】${score ?? "—"}% / 判定: ${verdict ?? "—"}`,
    `【自動チェック結果】`,
    noteLines || "（特記なし）",
  ].join("\n").slice(0, 4000);

  const r = await callLLM({ system: SYSTEM, prompt, maxTokens: 500, temperature: 0.3 });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: r.status });
  await logUsage("match-advice", r.model, r.usage);

  const parsed = parseJsonLoose<{ confirm?: unknown; strength?: unknown }>(r.text);
  if (!parsed) return Response.json({ ok: false, error: "AIの応答を解析できませんでした" }, { status: 502 });
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 3) : [];
  const out = { confirm: arr(parsed.confirm), strength: arr(parsed.strength) };
  if (key !== "-") cache.set(key, out);
  return Response.json({ ok: true, ...out });
}
