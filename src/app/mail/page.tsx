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
import { NextStepLink } from "@/components/NextStepLink";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Gmail ブランドロゴ（簡易カラー版）。「Gmail 取込」タブを一目で分かるように。
function GmailIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M6 38h6V22.3L4 16.5V36c0 1.1.9 2 2 2z"/>
      <path fill="#34A853" d="M36 38h6c1.1 0 2-.9 2-2V16.5l-8 5.8V38z"/>
      <path fill="#FBBC04" d="M36 12.8V22.3l8-5.8v-3.7c0-3-3.4-4.7-5.8-2.9L36 12.8z"/>
      <path fill="#EA4335" d="M12 22.3v-9.5l12 9 12-9v9.5l-12 9z"/>
      <path fill="#C5221F" d="M4 12.8v3.7l8 5.8v-9.5L9.8 9.9C7.4 8.1 4 9.8 4 12.8z"/>
    </svg>
  );
}

type Tab = "inbox" | "import" | "sent";
const TABS: { key: Tab; label: string; icon: string; desc: string }[] = [
  { key: "inbox",  label: "お問い合わせ", icon: "inbox",       desc: "enger.jp のお問い合わせフォームから届いた連絡。対応状況を管理。" },
  { key: "import", label: "Gmail 取込",   icon: "mail",        desc: "Gmail を同期し、AI抽出で案件/人材として登録。自動取込も可能。" },
  { key: "sent",   label: "送信履歴",     icon: "send",        desc: "ENGER から送信したメールの記録（誰が・いつ・誰に・何を）。" },
];

function PipeStat({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700 }}>{label}</span>
      <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: tone }}>{n.toLocaleString()}</span>
    </div>
  );
}

export default async function MailPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string; q?: string; sender?: string }> }) {
  const sp = await searchParams;
  const tab: Tab = (["inbox", "import", "sent"] as const).includes(sp.tab as any) ? (sp.tab as Tab) : "inbox";

  let dbError: string | null = null;
  let needSetup = false;
  let pipelineCounts: { total: number; unprocessed: number; extracted: number; registered: number; archived: number } | null = null;

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

      // Gmail取込パイプラインの状態別件数（常に集計してタブのバッジに表示）
      const [cTotal, cUnproc, cExtracted, cRegistered, cArchived] = await Promise.all([
        sb.from("inbox_emails").select("id", { count: "exact", head: true }),
        sb.from("inbox_emails").select("id", { count: "exact", head: true }).is("extracted_at", null).eq("is_archived", false),
        sb.from("inbox_emails").select("id", { count: "exact", head: true }).not("extracted_at", "is", null).is("registered_at", null).eq("is_archived", false),
        sb.from("inbox_emails").select("id", { count: "exact", head: true }).not("registered_at", "is", null),
        sb.from("inbox_emails").select("id", { count: "exact", head: true }).eq("is_archived", true),
      ]);
      pipelineCounts = {
        total: cTotal.count ?? 0,
        unprocessed: cUnproc.count ?? 0,
        extracted: cExtracted.count ?? 0,
        registered: cRegistered.count ?? 0,
        archived: cArchived.count ?? 0,
      };

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
      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Mail · メール</div>
          <h1>メール</h1>
          <div className="sub">{cur.desc}</div>
        </div>
        {tab === "import" && (
          <NextStepLink href="/jobs" label="案件を確認" hint="取込・登録された案件一覧へ" />
        )}
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
              {t.key === "import"
                ? <GmailIcon size={16} />
                : <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{t.icon}</span>}
              {t.label}
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
      {tab === "import" && !needSetup && pipelineCounts && (
        <div className="card" style={{ padding: "12px 14px", marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14, background: "var(--color-surface-soft)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 10.5, color: "var(--color-ink-4)", fontWeight: 700, letterSpacing: ".04em" }}>取込パイプライン</span>
            <span style={{ fontSize: 12, color: "var(--color-ink-3)" }}>累計 <b style={{ color: "var(--color-ink)", fontSize: 14 }}>{pipelineCounts.total.toLocaleString()}</b> 通を蓄積</span>
          </div>
          <span style={{ color: "var(--color-ink-4)" }}>→</span>
          <PipeStat label="未処理" n={pipelineCounts.unprocessed} tone="#0095D9" />
          <span style={{ color: "var(--color-ink-4)" }}>→</span>
          <PipeStat label="AI抽出済" n={pipelineCounts.extracted} tone="#7c3aed" />
          <span style={{ color: "var(--color-ink-4)" }}>→</span>
          <PipeStat label="登録済（マッチング使用可）" n={pipelineCounts.registered} tone="#067647" />
          <PipeStat label="アーカイブ" n={pipelineCounts.archived} tone="#94a3b8" />
        </div>
      )}
      {tab === "import" && !needSetup && <MailboxClient rows={importRows} filter={importFilter} gmailReady={gmailConfigured()} />}
      {tab === "sent" && !needSetup && <MailLogClient rows={sentRows} initialQ={sentQ} initialSender={sentSender} />}
    </div>
  );
}
