// 日報への新着返信を知らせるダッシュボード用バナー（サーバーコンポーネント）。
//   未読の返信(kind=feedback)が1件以上あるときだけ表示。
import Link from "@/components/AppLink";
import { unreadReplyCount } from "@/lib/notifications";

export async function ReplyAlertBanner({ name }: { name: string | null }) {
  if (!name) return null;
  const n = await unreadReplyCount(name);
  if (n <= 0) return null;
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <Link href="/notifications" style={{ textDecoration: "none" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, background: "#fdecef", border: "1px solid #f7c5cf", color: "#b42318", fontWeight: 700, fontSize: 13.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>mark_email_unread</span>
          日報への新着返信が {n} 件あります
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}>お知らせを開く →</span>
        </div>
      </Link>
    </div>
  );
}
