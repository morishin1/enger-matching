// ============================================================
// ENGER business（enger-lp）向け：入力フォーム定義の配信API。
//   会社情報／案件／人材の入力項目を DX（enger-matching）の定義（business-forms.ts）から
//   そのまま返す。enger-lp はこの定義でフォームを描画するため、項目は常に DX と一致する
//   （＝「入力フォームなどの入力内容は一緒にして」の実装）。認証不要（定義のみで秘匿情報なし）。
// ============================================================
import { NextRequest, NextResponse } from "next/server";
import { bizCorsHeaders } from "@/lib/business-api";
import { BUSINESS_FORM_DEFS } from "@/lib/business-forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: bizCorsHeaders(req.headers.get("origin"), "GET,OPTIONS") });
}

export function GET(req: NextRequest) {
  return NextResponse.json({ ok: true, forms: BUSINESS_FORM_DEFS }, { headers: bizCorsHeaders(req.headers.get("origin"), "GET,OPTIONS") });
}
