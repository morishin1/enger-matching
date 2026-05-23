import { NotificationsClient } from "@/components/NotificationsClient";
import { listNotifications } from "@/lib/notifications";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const access = await currentAccess();
  const me = access?.name ?? "";
  const items = await listNotifications(me);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Notifications · お知らせ</div>
          <h1>お知らせ</h1>
          <div className="sub">管理者からのフィードバックや全体連絡が届きます。{me ? "" : "（氏名が未設定のため個人宛は表示されません）"}</div>
        </div>
      </div>
      <NotificationsClient items={items} me={me} />
    </div>
  );
}
