// 提案の「元メール本文」（案件 detail / 人材 note・exp）を、詳細モーダルを開いた時だけ取得するAPI。
//   提案ボード/履歴/失注分析は最大400件を一度に読むため、各行に長文の元メール本文を結合して
//   ブラウザまで送ると、件数ぶんの巨大ペイロードになり「提案管理が重い/開かない」原因になっていた。
//   本文はモーダルで1件開いた時しか使わないので、その時だけ proposal_id から個別に解決する。
import { engerClient, engerAdmin, dbConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!dbConfigured) return json({ ok: false, error: "DB 未設定" }, 503);
  const { id } = await ctx.params;
  if (!id) return json({ ok: false, error: "提案ID が必要です" }, 400);
  try {
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }

    // 提案 → 紐づく案件/人材の id を取得
    const pr: any = await sb.from("proposals").select("job_id, candidate_id").eq("id", id).maybeSingle();
    if (pr.error || !pr.data) return json({ ok: true, jobDetail: null, candDetail: null });
    const { job_id, candidate_id } = pr.data as { job_id: string | null; candidate_id: string | null };

    // 案件本文(detail) / 人材本文(note → 無ければ exp)。列が無くても落ちないようフォールバック。
    const fetchJobDetail = async (): Promise<string | null> => {
      if (!job_id) return null;
      let r: any = await sb.from("jobs").select("detail").eq("id", job_id).maybeSingle();
      if (r.error || !r.data) return null;
      return (r.data.detail ?? null) as string | null;
    };
    const fetchCandDetail = async (): Promise<string | null> => {
      if (!candidate_id) return null;
      let r: any = await sb.from("candidates").select("note, exp").eq("id", candidate_id).maybeSingle();
      if (r.error || !r.data) {
        r = await sb.from("candidates").select("note").eq("id", candidate_id).maybeSingle();
        if (r.error || !r.data) return null;
      }
      return (r.data.note ?? r.data.exp ?? null) as string | null;
    };

    const [jobDetail, candDetail] = await Promise.all([fetchJobDetail(), fetchCandDetail()]);
    return json({ ok: true, jobDetail, candDetail });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
