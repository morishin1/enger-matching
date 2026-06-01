// 提案開始件数を期間で集計するAPI（created_at 基準）。
//   - 「提案開始」は created_at（提案レコードの作成日）を真実とする。
//     失注/稼働化にステージが移動しても作成日は不変なので、開始件数として一貫してカウントできる。
//   - GET /api/proposals/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
//     未指定なら本日。to は inclusive（その日の 23:59:59 まで）。
import { engerClient, dbConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  if (!dbConfigured) return json({ ok: false, error: "DB 未設定" }, 503);
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : today;
  const to   = isDate(url.searchParams.get("to"))   ? url.searchParams.get("to")!   : from;
  // to を inclusive にするため翌日の00:00未満で比較（タイムゾーンは UTC 基準）
  const toExclusive = new Date(new Date(`${to}T00:00:00Z`).getTime() + 24 * 3600 * 1000).toISOString();
  const fromIso = `${from}T00:00:00Z`;

  try {
    const sb = engerClient();
    const total = await sb.from("proposals").select("id", { count: "exact", head: true })
      .gte("created_at", fromIso).lt("created_at", toExclusive);
    // 提案者ごとの内訳（最大15人）。proposer 列が無い旧スキーマでも落ちないよう try
    let byProposer: Record<string, number> = {};
    try {
      const r: any = await sb.from("proposals").select("proposer").gte("created_at", fromIso).lt("created_at", toExclusive).limit(2000);
      if (!r.error) for (const row of (r.data ?? [])) { const k = row.proposer || "（未割当）"; byProposer[k] = (byProposer[k] ?? 0) + 1; }
    } catch { /* 列なしならスキップ */ }
    return json({ ok: true, from, to, count: total.count ?? 0, byProposer });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
