// Gmail 受信メール一覧（手動同期 → 営業が AI抽出 → 案件/人材として登録）。
//   完全手動運用：必要な分だけ AI を呼ぶことで Gemini 自動運用時の高額コストを回避。
import { engerClient, dbConfigured } from "@/lib/supabase";
import { gmailConfigured } from "@/lib/gmail-api";
import { MailboxClient } from "@/components/MailboxClient";

export const dynamic = "force-dynamic";

export default async function MailboxPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "unprocessed" } = await searchParams;

  let rows: any[] = [];
  let dbError: string | null = null;
  let needSetup = false;

  if (dbConfigured) {
    try {
      const sb = engerClient();
      let qb: any = sb.from("inbox_emails")
        .select("id, gmail_message_id, subject, from_email, from_name, body, has_attachment, attachment_names, received_at, synced_at, extracted_at, extracted_kind, extracted_summary, extracted_data, registered_at, registered_job_no, registered_candidate_no, is_archived")
        .order("received_at", { ascending: false }).limit(500);
      if (filter === "unprocessed") qb = qb.is("extracted_at", null).eq("is_archived", false);
      else if (filter === "extracted") qb = qb.not("extracted_at", "is", null).is("registered_at", null).eq("is_archived", false);
      else if (filter === "registered") qb = qb.not("registered_at", "is", null);
      else if (filter === "archived") qb = qb.eq("is_archived", true);
      const r: any = await qb;
      if (r.error) needSetup = true;
      else rows = r.data ?? [];
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Mailbox · 受信メール（Gmail）</div>
          <h1>受信メール</h1>
          <div className="sub">
            Gmail から手動で同期したメールを溜め、必要な分だけ「<b>AI抽出</b>」で構造化して案件/人材として登録します。
            <b style={{ color: "var(--color-danger)" }}>AI コストは「抽出ボタン押下時のみ」</b>発生（1通約 0.7円・Claude Haiku 4.5）。
          </div>
        </div>
      </div>

      {dbError && (
        <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          <b>DB:</b> {dbError}
        </div>
      )}

      {needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>受信メールテーブルが未作成です。</b> Supabase の SQL Editor で <span className="mono">supabase/inbox-emails.sql</span> を実行してください。
        </div>
      )}

      {!gmailConfigured() && !needSetup && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5 }}>
          <b>Gmail OAuth が未設定です。</b> Vercel 環境変数に
          <span className="mono"> GMAIL_CLIENT_ID</span> /
          <span className="mono"> GMAIL_CLIENT_SECRET</span> /
          <span className="mono"> GMAIL_REFRESH_TOKEN</span> を設定すると、Gmail 同期ボタンが使えるようになります。
        </div>
      )}

      {!needSetup && <MailboxClient rows={rows} filter={filter} gmailReady={gmailConfigured()} />}
    </div>
  );
}
