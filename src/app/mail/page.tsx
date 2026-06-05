// メールハブ（/mail）。受信箱(問合せ)・Gmail取込・送信履歴を 1 ページ 3 タブに統合。
//   各タブはアクティブ時のみデータ取得（既存の3コンポーネントを再利用）。
//     ?tab=inbox  … enger.jp お問い合わせ（contact_messages）
//     ?tab=import … Gmail 取込（inbox_emails）+ AI抽出 → 案件/人材登録
//     ?tab=sent   … 送信履歴（mail_sent）

import { engerClient, engerAdmin, dbConfigured } from "@/lib/supabase";
import { gmailConfigured } from "@/lib/gmail-api";
import { MailboxClient } from "@/components/MailboxClient";
import { MailLogClient } from "@/components/MailLogClient";
import { InboxClient, type ContactMsg } from "@/components/InboxClient";
import Link from "next/link";

export const dynamic = "force-dynamic";

type Tab = "inbox" | "import" | "sent";
const TABS: { key: Tab; label: string; icon: string; desc: string }[] = [
  { key: "inbox",  label: "お問い合わせ", icon: "inbox",       desc: "enger.jp のお問い合わせフォームから届いた連絡。対応状況を管理。" },
  { key: "import", label: "Gmail 取込",   icon: "mail",        desc: "Gmail を同期し、AI抽出で案件/人材として登録。自動取込も可能。" },
  { key: "sent",   label: "送信履歴",     icon: "send",        desc: "ENGER から送信したメールの記録（誰が・いつ・誰に・何を）。" },
];

export default async function MailPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string; q?: string; sender?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (["inbox", "import", "sent"] as const).includes(sp.tab as any) ? (sp.tab as Tab) : "inbox";

  let dbError: string | null = null;
  let needSetup = false;

  // ── データ取得（アクティブタブのみ）──
  let contactRows: ContactMsg[] = [];
  let importRows: any[] = [];
  let sentRows: any[] = [];
  const importFilter = sp.filter ?? "unprocessed";
  const sentQ = sp.q ?? "";
  const sentSender = sp.sender ?? "";

  if (dbConfigured) {
    try {
      // 内部スタッフ用の管理画面（サーバー側・認証済み）。これらのテーブルは RLS で
      // anon からは0件になるため、service role で読む（無ければ anon にフォールバック）。
      let sb: ReturnType<typeof engerClient>;
      try { sb = engerAdmin(); } catch { sb = engerClient(); }
      if (tab === "inbox") {
        const { data, error } = await sb.from("contact_messages")
          .select("id, company, name, email, phone, topic, role, message, source, status, created_at")
          .order("created_at", { ascending: false }).limit(300);
        if (error) dbError = error.message;
        contactRows = (data ?? []) as ContactMsg[];
      } else if (tab === "import") {
        let qb: any = sb.from("inbox_emails")
          .select("id, gmail_message_id, subject, from_email, from_name, body, has_attachment, attachment_names, received_at, synced_at, extracted_at, extracted_kind, extracted_summary, extracted_data, registered_at, registered_job_no, registered_candidate_no, is_archived")
          .order("received_at", { ascending: false }).limit(500);
        if (importFilter === "unprocessed") qb = qb.is("extracted_at", null).eq("is_archived", false);
        else if (importFilter === "extracted") qb = qb.not("extracted_at", "is", null).is("registered_at", null).eq("is_archived", false);
        else if (importFilter === "registered") qb = qb.not("registered_at", "is", null);
        else if (importFilter === "archived") qb = qb.eq("is_archived", true);
        const r: any = await qb;
        if (r.error) needSetup = true; else importRows = r.data ?? [];
      } else {
        let qb: any = sb.from("mail_sent")
          .select("id, sender_key, from_address, to_address, cc_address, bcc_address, subject, body, message_id, sent_by_email, sent_by_name, related_kind, related_id, created_at")
          .order("created_at", { ascending: false }).limit(500);
        if (sentSender) qb = qb.eq("sender_key", sentSender);
        const needle = sentQ.trim();
        if (needle) {
          const like = `%${needle.replace(/[%_]/g, (m) => "\\" + m)}%`;
          qb = qb.or(`subject.ilike.${like},to_address.ilike.${like},from_address.ilike.${like},sent_by_name.ilike.${like},sent_by_email.ilike.${like}`);
        }
        const r: any = await qb;
        if (r.error) needSetup = true; else sentRows = r.data ?? [];
      }
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }
  } else {
    dbError = "Supabase の環境変数が未設定です";
  }

  const cur = TABS.find((t) => t.key === tab)!;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Mail · メール</div>
          <h1>メール</h1>
          <div className="sub">{cur.desc}</div>
        </div>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--color-border)", marginBottom: 14 }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Link key={t.key} href={`/mail?tab=${t.key}`} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", textDecoration: "none",
              borderBottom: on ? "2px solid var(--color-brand-600)" : "2px solid transparent",
              color: on ? "var(--color-brand-700)" : "var(--color-ink-3)", fontWeight: on ? 700 : 600, fontSize: 13,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
            </Link>
          );
        })}
      </div>

      {dbError && <div className="card" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}><b>DB:</b> {dbError}</div>}

      {tab === "import" && needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>受信メールテーブルが未作成です。</b> Supabase で <span className="mono">supabase/inbox-emails.sql</span> を実行してください。
        </div>
      )}
      {tab === "import" && !gmailConfigured() && !needSetup && (
        <div className="card" style={{ background: "#fff6e0", borderColor: "#fde9b0", color: "#9a7b12", fontSize: 12.5 }}>
          <b>Gmail OAuth が未設定です。</b> Vercel 環境変数に
          <span className="mono"> GMAIL_CLIENT_ID</span> /<span className="mono"> GMAIL_CLIENT_SECRET</span> /<span className="mono"> GMAIL_REFRESH_TOKEN</span> を設定すると同期できます。
        </div>
      )}
      {tab === "sent" && needSetup && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)" }}>
          <b>送信履歴テーブルが未作成です。</b> Supabase で <span className="mono">supabase/mail-sent.sql</span> を実行してください。
        </div>
      )}

      {tab === "inbox" && <InboxClient rows={contactRows} />}
      {tab === "import" && !needSetup && <MailboxClient rows={importRows} filter={importFilter} gmailReady={gmailConfigured()} />}
      {tab === "sent" && !needSetup && <MailLogClient rows={sentRows} initialQ={sentQ} initialSender={sentSender} />}
    </div>
  );
}
