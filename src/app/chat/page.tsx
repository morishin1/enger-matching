import { ChatClient } from "@/components/ChatClient";
import { listChatThreads, getChatThread } from "@/lib/chat";
import { listEngineers } from "@/lib/engineers";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  const me = access?.email ?? "";
  const meName = access?.name ?? access?.email ?? "担当";
  // 新規スレッド作成・削除・タイトル/メモ編集は ENGERスタッフ（admin/agent）のみ。
  const isStaff = access?.role === "admin" || access?.role === "agent";

  const threads = await listChatThreads(me);
  // 指定スレッド(sp.t)を最優先で開く。直近300件の一覧に無くても直接取得できれば開く
  //   （スカウト→open-thread 直後の新規スレッドへの遷移に対応）。無ければ先頭スレッド。
  const selected = (sp.t ? await getChatThread(sp.t) : null) ?? (threads[0] ? await getChatThread(threads[0].id) : null);
  const selectedId = selected?.thread.id ?? null;

  // 新規スレッドの相手（フリーランス）選択用の軽量リスト。スタッフのみ取得。
  let engineers: { id: string; name: string }[] = [];
  if (isStaff) {
    try {
      const { rows } = await listEngineers();
      engineers = rows
        .map((e: any) => ({ id: String(e.id), name: (e.display_name || e.name || e.github_login || "（無名）") as string }))
        .filter((e) => e.id);
    } catch { /* 取得失敗は空でも続行（手入力フォールバックは無し） */ }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Chat · 企業 × フリーランス（担当仲介）</div>
          <h1>チャット</h1>
          <div className="sub">スカウト後のやり取りをスレッドで管理します。企業と人材の間に担当が入り、連絡先は伏せたまま会話できます。既読は参加者ごとに表示されます。</div>
        </div>
      </div>
      <ChatClient threads={threads} selected={selected} me={me} meName={meName} isStaff={isStaff} engineers={engineers} />
    </div>
  );
}
