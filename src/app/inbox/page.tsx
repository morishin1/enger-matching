import { engerClient, dbConfigured } from "@/lib/supabase";
import { InboxClient, type ContactMsg } from "@/components/InboxClient";

export const dynamic = "force-dynamic";

/** 受信箱：enger.jp のお問い合わせフォーム送信（enger.contact_messages）を管理。 */
export default async function InboxPage() {
  let rows: ContactMsg[] = [];
  let dbError: string | null = null;
  if (dbConfigured) {
    try {
      const sb = engerClient();
      const { data, error } = await sb.from("contact_messages")
        .select("id, company, name, email, phone, topic, role, message, source, status, created_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error) dbError = error.message;
      rows = (data ?? []) as ContactMsg[];
    } catch (e) { dbError = e instanceof Error ? e.message : String(e); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">受信箱 · お問い合わせ</div>
          <h1>受信箱</h1>
          <div className="sub">enger.jp のお問い合わせフォームから届いた連絡です。対応状況を更新して管理できます。</div>
        </div>
      </div>
      {dbError && <div className="card" style={{ borderColor: "var(--color-warn,#e0a317)", color: "var(--color-ink-2)", fontSize: 13 }}>受信箱の取得に失敗しました（{dbError}）。SQL <b className="mono">contact-messages.sql</b> の実行をご確認ください。</div>}
      <InboxClient rows={rows} />
    </div>
  );
}
