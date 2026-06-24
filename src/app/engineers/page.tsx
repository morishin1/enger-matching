import { EngineersClient } from "@/components/EngineersClient";
import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { FlowSteps } from "@/components/FlowSteps";
import { listEngineers, listEngineerActions, listScouts, listApplications } from "@/lib/engineers";
import { listEngineerChatStatus } from "@/lib/chat";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function EngineersPage() {
  const access = await currentAccess();
  const [{ rows, available }, actions, scouts, applications, chatStatus] = await Promise.all([
    listEngineers(), listEngineerActions(), listScouts(), listApplications(), listEngineerChatStatus(access?.email),
  ]);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">ENGER · LP登録（各ランディングページ経由）</div>
          <h1>LP登録</h1>
          <div className="sub">
            各LP（<b>enger.jp</b> / <b>無限道場</b> など）から中央 Supabase <b className="mono">public.profiles</b> へ登録され自動表示されます。
            各バッジは <b>「LP名 · 登録方式」</b> を表示（例：エンジャーLP · GitHub / 無限道場LP · Google）。各行の「✦ マッチング」で候補者として取り込み、マッチング画面で案件を探せます。
            <br />
            <span className="muted" style={{ fontSize: 11.5 }}>※ 正確な判別には profiles に <code>signup_source</code> / <code>signup_method</code> 列の保存を推奨（未実装でもヒューリスティックで判定）。</span>
          </div>
        </div>
      </div>

      <FlowSteps current="mail" sub="LP経由のエンジニア取込" />

      <MatchingPeerTabsServer />

      {!available && (
        <div className="card" style={{ borderColor: "var(--color-warn, #e0a317)", color: "var(--color-ink-2)", fontSize: 13 }}>
          <b>未連携：</b> enger.jp 側のエンジニア情報（public.profiles）に接続できませんでした。Supabase の環境変数（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）と public.profiles テーブルの存在を確認してください。
        </div>
      )}

      <EngineersClient engineers={rows} actions={actions} scouts={scouts} applications={applications} chatStatus={chatStatus} />
    </div>
  );
}
