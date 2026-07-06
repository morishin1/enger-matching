// ============================================================
// ENGER business（enger-lp）向け：候補者フィードバックAPI。
//   ドロワー内の「会いたい / 検討中 / ミスマッチ」ボタンから呼ぶ。
//   POST { proposal_id, verdict: "want"|"maybe"|"mismatch", reason? }
//   DX ポータルの submitClientFeedback と同じ検証（自社提案のみ）・同じ保存先（client_feedback）。
//   認証：Bearer。承認済み（active）の法人アカウントのみ。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { bizCorsHeaders, resolveBusinessViewer } from "@/lib/business-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = "POST,OPTIONS";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), METHODS) });
}

export async function POST(req: NextRequest) {
  const cors = bizCorsHeaders(req.headers.get("origin"), METHODS);
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors });
  if (!dbConfigured) return json({ ok: false, error: "DB未設定" }, 503);
  const viewer = await resolveBusinessViewer(req);
  if (!viewer.ok) return json({ ok: false, error: viewer.error }, viewer.status);

  let body: any = null;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSONボディが必要です" }, 400); }
  const proposalId = String(body?.proposal_id ?? "").trim();
  const verdict = String(body?.verdict ?? "");
  const reason = String(body?.reason ?? "").trim().slice(0, 500);
  if (!proposalId || !["want", "maybe", "mismatch"].includes(verdict)) return json({ ok: false, error: "入力が不正です" }, 400);

  try {
    const sb = engerAdmin();
    // 自社の提案であることを確認（company 名寄せ。portal の submitClientFeedback と同じ判定）。
    const { data: prop } = await sb.from("proposals").select("id, company").eq("id", proposalId).maybeSingle();
    if (!prop) return json({ ok: false, error: "提案が見つかりません" }, 404);
    const company = viewer.companyName;
    if (company && prop.company && !String(prop.company).includes(company) && !company.includes(String(prop.company))) {
      return json({ ok: false, error: "自社の提案ではありません" }, 403);
    }
    const { error } = await sb.from("client_feedback").upsert({
      proposal_id: proposalId,
      company: viewer.companyName ?? prop.company ?? null,
      verdict,
      reason: reason || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "proposal_id" });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
