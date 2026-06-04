// メール送信履歴。誰がいつどの差出人で誰に何を送ったかを一覧表示。
import { engerClient, dbConfigured } from "@/lib/supabase";
import { MailLogClient } from "@/components/MailLogClient";

export const dynamic = "force-dynamic";

export default async function MailLogPage({ searchParams }: { searchParams: Promise<{ q?: string; sender?: string }> }) {
  const { q = "", sender = "" } = await searchParams;
  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      let qb: any = sb.from("mail_sent")
        .select("id, sender_key, from_address, to_address, cc_address, bcc_address, subject, body, message_id, sent_by_email, sent_by_name, related_kind, related_id, created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (sender) qb = qb.eq("sender_key", sender);
      const needle = q.trim();
      if (needle) {
        const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
        qb = qb.or(`subject.ilike.${like},to_address.ilike.${like},from_address.ilike.${like},sent_by_name.ilike.${like},sent_by_email.ilike.${like}`);
      }
      const r: any = await qb;
      if (r.error) needSetup = true;
      else rows = r.data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase 未設定";
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Mail Log · 送信履歴</div>
          <h1>メール送信履歴</h1>
          <div className="sub">ENGER から送信したメールの記録（誰がいつどの差出人で誰に何を送ったか）。送信失敗（SMTPエラー）は記録されません。</div>
        </div>
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}
      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>送信履歴テーブルが未作成です。</b> Supabase の SQL Editor で <span className="mono">supabase/mail-sent.sql</span> を実行してください。
        </div>
      )}

      {!needSetup && <MailLogClient rows={rows} initialQ={q} initialSender={sender} />}
    </div>
  );
}
