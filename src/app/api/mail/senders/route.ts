// 設定済みの差出人（enger / 8grp）一覧を返す。メール送信UIの差出人セレクト用。
import { availableSenders, smtpConfigured } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const senders = availableSenders().map((s) => ({ key: s.key, label: s.label, address: s.address }));
  return new Response(JSON.stringify({ ok: true, configured: smtpConfigured(), senders }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
