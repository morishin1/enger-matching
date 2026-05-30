// 今日やるべきことの AI ブリーフィング（営業ダッシュボード）。
//   ダッシュボードの集計値を渡し、優先度つきの短い指示コメントを生成。
//   コスト配慮：日付＋指標のハッシュで1日1回キャッシュ（再課金しない）。

import { callLLM } from "@/lib/llm";
import { logUsage } from "@/lib/ai-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = [
  "あなたはエンジニア人材紹介エージェントの業務コーチです。",
  "成長レバーは『人数』ではなく『リード品質 × 各ステージの歩留まり』。",
  "接触前失注は“そもそも有効でないリード”として母数から除外して考えます。",
  "提案数が減っても質が上がっていれば良し、と評価します。",
  "出力は日本語。前置き・お世辞は書かず、今日やるべきことを優先度順に3〜5個、各1行で簡潔に。",
  "各項目は『何を・なぜ(数字根拠)』の形。最後に一言だけ短い励まし。Markdownの見出しは使わず、各行を「・」で始める。",
].join("");

const cache = new Map<string, string>();

export async function POST(req: Request) {
  let metrics: any = null;
  try { metrics = (await req.json())?.metrics ?? null; } catch { return Response.json({ ok: false, error: "リクエストが不正です" }, { status: 400 }); }
  if (!metrics) return Response.json({ ok: false, error: "metrics がありません" }, { status: 400 });

  const day = new Date().toISOString().slice(0, 10);
  const key = day + "|" + JSON.stringify(metrics);
  if (cache.has(key)) return Response.json({ ok: true, text: cache.get(key), cached: true });

  const prompt = [
    `本日(${day})の状況です。これを踏まえ、今日やるべきことを優先度順にまとめてください。`,
    "",
    "【締切のあるアクション】",
    `本日の面談/面談調整中: ${metrics.meetings ?? 0}`,
    `要更新確認(30日以内満了): ${metrics.renewSoon ?? 0}`,
    `初動待ち(返信待ち/未架電): ${metrics.callPending ?? 0}`,
    `クロージング滞留(7日+): ${metrics.closingStalled ?? 0}`,
    "",
    "【需要(案件)】",
    `注力・未提案: ${metrics.focusUntouched ?? 0} / 鮮度切れ: ${metrics.staleJobs ?? 0} / 新着在庫(参照): ${metrics.newJobs ?? 0}`,
    "【供給(人材)】",
    `ホット(即動ける): ${metrics.hot ?? 0} / 満了間近・再提案候補(60日内): ${metrics.endingSoon ?? 0}`,
    "",
    "【お金】",
    `見込み月額: ${metrics.pipelineMan ?? 0}万円 / 確定月額: ${metrics.confirmedMan ?? 0}万円`,
    `ファネル 案件${metrics.fJobs ?? 0}→提案${metrics.fProposed ?? 0}→面談${metrics.fMet ?? 0}→稼働${metrics.fActive ?? 0}`,
    "",
    "注意: 件数を増やすより歩留まりと既存売上(契約更新)の防衛を重視。",
  ].join("\n");

  const r = await callLLM({ system: SYSTEM, prompt, maxTokens: 360, temperature: 0.4 });
  if (!r.ok) return Response.json({ ok: false, error: r.error }, { status: r.status });

  await logUsage("brief", r.model, r.usage);
  cache.set(key, r.text);
  return Response.json({ ok: true, text: r.text });
}
