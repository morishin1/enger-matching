// ============================================================
// ENGER business（enger-lp）向け：候補者・人材の一覧API。
//   企業ダッシュボード「候補者・人材」＝自社案件に来た人材（応募＋エージェントからのご提案）の一覧。
//   DX の proposals（提案管理）から自社分のみを、匿名項目のホワイトリストで返す
//   （UI規約：企業に見せる人材情報は常に匿名＝イニシャル＋スキル＋単価。氏名/連絡先は返さない）。
//   企業のフィードバック（client_feedback：会いたい/検討中/ミスマッチ）も併せて返す（ドロワー表示用）。
//   認証：Bearer。承認済み（active）の法人アカウントのみ＝「承認をうけたらフル機能」。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "GET,OPTIONS";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function GET(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  try {
    const sb = engerAdmin();
    const like = `%${viewer.companyName}%`;
    // 匿名ホワイトリスト：氏名(candidate_name)・連絡先・社内メモは絶対に含めない。
    const base = "id, job_id, candidate_id, job_title, c_init, rate, score, stage, source, created_at, stage_updated_at";
    let r: any = await sb.from("proposals").select(base).ilike("company", like).order("created_at", { ascending: false }).limit(300);
    if (r.error) r = await sb.from("proposals").select("id, job_id, candidate_id, job_title, c_init, rate, stage, created_at").ilike("company", like).order("created_at", { ascending: false }).limit(300);
    if (r.error) return json({ ok: false, error: r.error.message }, 500);
    const rows = (r.data ?? []) as any[];

    // ドロワー用の追加情報（すべて匿名の範囲）：候補者のスキル・職種・経験・リモート希望・稼働。
    const candIds = Array.from(new Set(rows.map((p) => p.candidate_id).filter(Boolean)));
    const candById = new Map<string, any>();
    if (candIds.length) {
      let cr: any = await sb.from("candidates").select("id, initials, title, skills, exp, remote_pref, avail, age_band, nationality").in("id", candIds).limit(1000);
      if (cr.error) cr = await sb.from("candidates").select("id, initials, title, skills").in("id", candIds).limit(1000);
      for (const c of (cr?.data ?? []) as any[]) candById.set(c.id, c);
    }
    // 企業フィードバック（会いたい/検討中/ミスマッチ）を併読（一覧バッジ＋ドロワーの既回答表示）。
    const fbByProposal = new Map<string, { verdict: string; reason: string | null }>();
    try {
      const ids = rows.map((p) => p.id);
      if (ids.length) {
        const fr: any = await sb.from("client_feedback").select("proposal_id, verdict, reason").in("proposal_id", ids).limit(1000);
        for (const f of (fr?.data ?? []) as any[]) fbByProposal.set(f.proposal_id, { verdict: f.verdict, reason: f.reason ?? null });
      }
    } catch { /* client_feedback 未整備でも続行 */ }

    // AI面接の依頼・結果（§5 Phase B）を併読。テーブル未整備でも無視して続行。
    const aiByProposal = new Map<string, { status: string | null; score: number | null; report_url: string | null; video_url: string | null; summary: string | null }>();
    try {
      const ids = rows.map((p) => p.id);
      if (ids.length) {
        const ar: any = await sb.from("ai_interviews").select("proposal_id, status, score, report_url, video_url, summary").in("proposal_id", ids).limit(1000);
        for (const a of (ar?.data ?? []) as any[]) aiByProposal.set(a.proposal_id, { status: a.status ?? null, score: a.score ?? null, report_url: a.report_url ?? null, video_url: a.video_url ?? null, summary: a.summary ?? null });
      }
    } catch { /* ai_interviews 未整備でも続行 */ }

    const items = rows.map((p) => {
      const c = p.candidate_id ? candById.get(p.candidate_id) : null;
      const fb = fbByProposal.get(p.id) ?? null;
      return {
        id: p.id,
        job_title: p.job_title ?? null,
        stage: p.stage ?? null,
        source: p.source ?? null,            // "line" 等（応募経路の表示に使える）
        created_at: p.created_at ?? null,
        stage_updated_at: p.stage_updated_at ?? null,
        candidate: {
          initials: c?.initials ?? p.c_init ?? null,
          title: c?.title ?? null,
          skills: Array.isArray(c?.skills) ? c.skills : [],
          rate: p.rate ?? null,
          exp: c?.exp ?? null,
          remote_pref: c?.remote_pref ?? null,
          avail: c?.avail ?? null,
          age_band: c?.age_band ?? null,
          nationality: c?.nationality ?? null,
        },
        score: p.score ?? null,
        feedback: fb,                         // { verdict: want|maybe|mismatch, reason } | null
        ai_interview: aiByProposal.get(p.id) ?? null, // { status, score, report_url, video_url, summary } | null（§5）
      };
    });
    return json({ ok: true, proposals: items });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
