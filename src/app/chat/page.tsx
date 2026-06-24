import { ChatClient } from "@/components/ChatClient";
import { listChatThreads, getChatThread } from "@/lib/chat";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  const me = access?.email ?? "";
  const meName = access?.name ?? access?.email ?? "担当";

  const threads = await listChatThreads(me);
  const selectedId = sp.t && threads.some((t) => t.id === sp.t) ? sp.t : threads[0]?.id ?? null;
  const selected = selectedId ? await getChatThread(selectedId) : null;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Chat · 企業 × フリーランス（担当仲介）</div>
          <h1>チャット</h1>
          <div className="sub">スカウト後のやり取りをスレッドで管理します。企業と人材の間に担当が入り、連絡先は伏せたまま会話できます。既読は参加者ごとに表示されます。</div>
        </div>
      </div>
      <ChatClient threads={threads} selected={selected} me={me} meName={meName} />
    </div>
  );
}
