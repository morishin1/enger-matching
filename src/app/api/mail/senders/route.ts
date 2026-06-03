// 設定済みの差出人（enger / 8grp）一覧 + ログイン者情報を返す。メール送信UIの差出人表示用。
import { availableSenders, smtpConfigured } from "@/lib/mailer";
import { currentAccess } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const senders = availableSenders().map((s) => ({ key: s.key, label: s.label, address: s.address }));
  let me: { name: string | null; email: string | null } = { name: null, email: null };
  try { const a = await currentAccess(); me = { name: a?.name ?? null, email: a?.email ?? null }; } catch { /* noop */ }
  return new Response(JSON.stringify({ ok: true, configured: smtpConfigured(), senders, me }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
