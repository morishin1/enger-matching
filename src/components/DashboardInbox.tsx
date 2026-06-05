// ダッシュボード用：enger.jp お問い合わせ（contact_messages）を取得して埋め込む。
//   旧 /mail?tab=inbox を廃止し、お問い合わせはダッシュボードに集約。
//   既定では折りたたみ、未対応（新規）があるときだけ開いて注意を促す。

import { engerClient, engerAdmin, dbConfigured } from "@/lib/supabase";
import { InboxClient, isJunkContact, type ContactMsg } from "@/components/InboxClient";
import { Collapsible } from "@/components/Collapsible";

export async function DashboardInbox() {
  if (!dbConfigured) return null;

  let rows: ContactMsg[] = [];
  try {
    // 内部スタッフ用（認証済み）。contact_messages は RLS で anon から0件のため service role で読む。
    let sb: ReturnType<typeof engerClient>;
    try { sb = engerAdmin(); } catch { sb = engerClient(); }
    const { data, error } = await sb.from("contact_messages")
      .select("id, company, name, email, phone, topic, role, message, source, status, created_at")
      .order("created_at", { ascending: false }).limit(300);
    if (error) return null; // テーブル未作成などは静かにスキップ
    rows = (data ?? []) as ContactMsg[];
  } catch {
    return null;
  }

  // 未対応（新規・ジャンク除く）件数。あれば既定で開く。
  const newCount = rows.filter((r) => r.status === "new" && !isJunkContact(r)).length;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="meta" style={{ marginBottom: 8 }}>お問い合わせ · enger.jp フォーム受信</div>
      <Collapsible
        label={`お問い合わせ一覧${newCount > 0 ? `（新規 ${newCount} 件）` : ""}`}
        defaultOpen={newCount > 0}
      >
        <InboxClient rows={rows} />
      </Collapsible>
    </div>
  );
}
