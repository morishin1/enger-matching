// SMTP 接続テスト API（管理者のみ）。メールは送らず、認証情報・サーバ接続のみ検証。
//   使用例:  GET /api/mail/test?sender=its    （既定）
//            GET /api/mail/test?sender=enger
//            GET /api/mail/test?sender=8grp
import { testSmtpAction } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sender = (url.searchParams.get("sender") || "its") as "enger" | "8grp" | "its";
  if (sender !== "enger" && sender !== "8grp" && sender !== "its") {
    return new Response(JSON.stringify({ ok: false, error: "sender は enger / 8grp / its" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const r = await testSmtpAction(sender);
  return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { "Content-Type": "application/json" } });
}
