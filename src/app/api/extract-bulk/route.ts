// 1通のメール（複数名の人材／複数案件をまとめて記載）を、個別レコードの配列に分離抽出する。
//   kind="candidates" → 人材の配列 / kind="jobs" → 案件の配列
//   OpenAI互換 と Anthropic(Claude) の両対応（callLLM が自動判別）。
import { callLLM, parseJsonLoose } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";
import { getAiCache, setAiCache } from "@/lib/ai-cache";
import { normalizeSkills } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAND_SCHEMA = `人材（要員）を **すべて** 抽出し、配列で返してください。1通に複数名いる場合は人数分の要素にします。
各要素のスキーマ:
{
  "name": string,                  // 氏名 or イニシャル（必須）
  "title": string | null,          // 職種（例: バックエンドエンジニア）
  "company": string | null,        // 所属会社（SES企業名）
  "affiliation": string | null,    // 区分（一社下社員 / 一社下フリーランス / 二社下以降 等）
  "skills": string[],              // スキル配列
  "rate": string | null,           // 希望単価（例: 80万 / ¥70〜90万）
  "exp": string | null,            // 経験年数
  "avail": string | null,          // 稼働開始（例: 即日 / 6月〜）
  "location": string | null        // 希望勤務地/最寄駅
}`;

const JOB_SCHEMA = `案件を **すべて** 抽出し、配列で返してください。1通に複数案件ある場合は件数分の要素にします。
各要素のスキーマ:
{
  "title": string,                 // 案件名・職務概要（必須）
  "client_name": string | null,    // クライアント企業名
  "role_label": string | null,     // 募集職種
  "skills": string[],              // 必要スキル配列
  "salary_min": number | null,     // 単価下限（万円・数値のみ）
  "salary_max": number | null,     // 単価上限（万円・数値のみ）
  "remote_type": "full_remote"|"partial_remote"|"onsite"|null,
  "work_location": string | null,  // 勤務地
  "start_date": string | null,     // 開始時期
  "flow_note": string | null,      // 商流
  "detail": string | null          // 案件詳細（元文の該当部分）
}`;

export async function POST(req: Request) {
  let text = "";
  let kind: "candidates" | "jobs" = "candidates";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 12000);
    kind = body?.kind === "jobs" ? "jobs" : "candidates";
  } catch {
    return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 });
  }
  if (!text.trim()) return Response.json({ ok: false, error: "text がありません" }, { status: 400 });

  // 同じメール本文の再抽出は課金しない（純関数なので共有キャッシュ。kind 別にキー化。30日TTL）。
  const ckey = kind + "|" + text;
  // 名前空間に v2 を付与：スキル正規化を導入したため、旧キャッシュ（未正規化）を引かせない。
  const cached = await getAiCache<any[]>("extract-bulk-v2", ckey, 30 * 86400);
  if (cached) return Response.json({ ok: true, kind, records: cached, cached: true });

  const schema = kind === "jobs" ? JOB_SCHEMA : CAND_SCHEMA;
  const system = `あなたはSES営業の${kind === "jobs" ? "案件" : "人材"}情報を構造化するアシスタントです。
1通のメール/書面に **複数の${kind === "jobs" ? "案件" : "要員"}** がまとめて書かれていることがあります。
それぞれを取り違えずに分離し、**JSON配列のみ** を返してください（説明・前置き・コードフェンス不要）。
分からない項目は null。氏名や案件名が読み取れない要素は含めないでください。
スキル（skills）は後段のマッチングで相手を探す最重要キーです。箇条書きでない会話調・口語（例「Javaが書ける」「AWS経験あり」「インフラ周り」「フロント全般」）からも、登場する技術名（言語/フレームワーク/ライブラリ/クラウド/DB/OS/ミドルウェア/ツール/資格/専門領域）を漏れなく拾って配列にしてください。略称や経験年数（例「Java(8年)」）は含めず一般的な技術名で（正規名への変換は後段で実施します）。技術的記載が一切ない場合のみ空配列。

${schema}`;

  const r = await callLLM({
    system,
    prompt: `以下のテキストから ${kind === "jobs" ? "案件" : "人材"} を抽出し、JSON配列だけを返してください。\n\n---\n${text}\n---`,
    maxTokens: 2400, temperature: 0.2,
  });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: r.status });
  await logUsage("extract-bulk", r.model, r.usage);

  // 配列 or {records:[...]} or 単一オブジェクト いずれでも配列化
  let parsed = parseJsonLoose<any>(r.text);
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.records)) parsed = parsed.records;
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") parsed = [parsed];
  if (!Array.isArray(parsed)) return Response.json({ ok: false, error: "AIの応答を解析できませんでした", raw: String(r.text).slice(0, 300) }, { status: 502 });

  // 必須キー（人材=name / 案件=title）が無い要素は除外
  const keyField = kind === "jobs" ? "title" : "name";
  const records = parsed
    .filter((x) => x && typeof x === "object" && typeof x[keyField] === "string" && x[keyField].trim())
    // スキルを ENGER 正規辞書で正規化（表記揺れ→正式名・重複排除）。貼り付け取込のフォーム反映を揃える。
    .map((x) => ({ ...x, skills: normalizeSkills(x.skills) }));
  await setAiCache("extract-bulk-v2", ckey, records);
  return Response.json({ ok: true, kind, records });
}
