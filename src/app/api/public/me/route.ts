// ============================================================
// ENGER business（enger-lp）向け：ログイン企業のステータス照会API。
//   企業ダッシュボードのメニュー出し分け（承認前=限定／承認後=フル機能）に使う。
//   GET → { ok, loggedIn, status: "active"|"pending"|"none", approved, companyName, name, reason? }
//     ・active  … 承認済み。フル機能（候補者・人材／エージェントに紹介／フィードバック等）を解放
//     ・pending … 承認待ち。会社情報の入力と案件の掲載申請のみ利用可
//     ・none    … 法人アカウントなし（or 未ログイン）。reason に案内文
// ============================================================
import { NextRequest, NextResponse } from "next/server";
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

  const v = await resolveBusinessViewer(req, { allowPending: true });
  if (v.ok) {
    return json({
      ok: true, loggedIn: true,
      status: v.status, approved: v.status === "active",
      companyName: v.companyName, name: v.name, email: v.email,
    });
  }
  // 未ログイン（401）と、法人アカウント無し/無効（403）をメニュー制御用に区別して 200 で返す。
  if (v.status === 401) return json({ ok: true, loggedIn: false, status: "none", approved: false, reason: v.error });
  return json({ ok: true, loggedIn: true, status: "none", approved: false, reason: v.error });
}
