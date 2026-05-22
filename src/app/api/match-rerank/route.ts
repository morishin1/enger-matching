import { callLLM, parseJsonLoose } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

/** ルールベース上位の候補を、LLMで文脈評価して再ランキング（適合度＋理由）。 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストが不正です" }, 400); }
  const job = body?.job ?? {};
  const candidates: any[] = Array.isArray(body?.candidates) ? body.candidates.slice(0, 12) : [];
  if (!candidates.length) return json({ ok: false, error: "候補がありません" }, 400);

  const system = "あなたはSES/エンジニア人材のマッチング専門家です。案件と候補者の適合度を文脈から評価し、必ず指定JSONのみで返します。";
  const jobDesc = [
    `案件: ${job.title ?? ""}`,
    job.role_label ? `職種: ${job.role_label}` : "",
    `必要スキル: ${(job.skills ?? []).join(" / ") || "—"}`,
    (job.salary_min || job.salary_max) ? `単価: ${job.salary_min ?? ""}〜${job.salary_max ?? ""}万円` : "",
    job.remote_type ? `リモート: ${job.remote_type}` : "",
  ].filter(Boolean).join("\n");
  const candList = candidates.map((c, i) =>
    `${i + 1}. no=${c.candidate_no} / ${c.name ?? ""} / ${c.title ?? ""} / 経験:${c.exp ?? "—"} / 希望単価:${c.rate ?? "—"} / リモート希望:${c.remote_pref ?? "—"} / スキル:${(c.skills ?? []).join(" ")}`
  ).join("\n");

  const prompt = [
    "次の案件に対して、各候補者の適合度を0〜100で採点し、JSON配列だけを出力してください（説明やコードフェンス不要）。",
    "スキルの類似(表記揺れ・関連技術)、単価整合、職種・リモート条件、経験年数の妥当性を総合評価してください。",
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
  const parsed = parseJsonLoose<any[]>(r.text);
  if (!Array.isArray(parsed)) return json({ ok: false, error: "AI応答の解析に失敗しました", raw: r.text.slice(0, 300) }, 502);

  const valid = new Set(candidates.map((c) => Number(c.candidate_no)));
  const results = parsed
    .map((p) => ({ candidate_no: Number(p.candidate_no), score: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))), reason: String(p.reason ?? "") }))
    .filter((p) => valid.has(p.candidate_no));
  return json({ ok: true, results });
}
