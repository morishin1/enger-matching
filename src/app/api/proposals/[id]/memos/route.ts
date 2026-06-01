// 提案メモの一覧取得API。詳細モーダルが開いた時にクライアントから呼ぶ。
// 書込は server action (addProposalMemo / deleteProposalMemo) を使う。
import { engerClient, dbConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!dbConfigured) return json({ ok: false, error: "DB 未設定" }, 503);
  const { id } = await ctx.params;
  if (!id) return json({ ok: false, error: "提案ID が必要です" }, 400);
  try {
    const sb = engerClient();
    const r: any = await sb.from("proposal_memos")
      .select("id, category, body, created_at, created_by_email, created_by_name")
      .eq("proposal_id", id).order("created_at", { ascending: false }).limit(200);
    if (r.error) return json({ ok: false, error: r.error.message }, 500);
    return json({ ok: true, memos: r.data ?? [] });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
