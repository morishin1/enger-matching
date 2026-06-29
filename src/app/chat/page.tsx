import { ChatClient } from "@/components/ChatClient";
import { listChatThreads, getChatThread, resolveEngineerSearch } from "@/lib/chat";
import { listEngineers, freelanceShortId } from "@/lib/engineers";
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

  // 新規スレッドの相手（フリーランス）選択用リスト。スタッフのみ取得。
  //   検索を「姓名（漢字・カタカナ）＋イニシャル」に対応させるため、各候補に氏名・フリガナ・イニシャルを付与。
  let engineers: { id: string; name: string; kana: string; initials: string | null; regInitial: string | null; sei: string; mei: string; freelanceId: string; account: string }[] = [];
  if (isStaff) {
    try {
      const { rows } = await listEngineers();
      const searchMap = await resolveEngineerSearch(rows.map((e: any) => String(e.id)));
      engineers = rows
        .map((e: any) => {
          const s = searchMap.get(String(e.id));
          // 表示名は漢字優先で解決（解決名→display_name→name→github）。最終フォールバックは別途 freelanceId / account を持たせる。
          const name = (s?.name || e.display_name || e.name || e.github_login || "") as string;
          // 極端な例外時の代替識別子（アカウントID / メールのローカルパート）。
          const account = (e.display_name || e.name || e.github_login || (e.email ? String(e.email).split("@")[0] : "") || "") as string;
          return {
            id: String(e.id),
            name,
            kana: s?.kana ?? "",
            initials: s?.initials ?? null,
            regInitial: s?.regInitial ?? null,
            sei: s?.sei ?? "",
            mei: s?.mei ?? "",
            freelanceId: freelanceShortId(String(e.id)), // 人材ID（E-C94D4）：氏名未登録時の表示名フォールバック
            account,
          };
        })
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
