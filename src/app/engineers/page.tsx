import { EngineersClient } from "@/components/EngineersClient";
import { listEngineers, listEngineerActions, listScouts, listApplications } from "@/lib/engineers";

export const dynamic = "force-dynamic";

export default async function EngineersPage() {
  const [{ rows, available }, actions, scouts, applications] = await Promise.all([listEngineers(), listEngineerActions(), listScouts(), listApplications()]);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">ENGER · サイト経由登録（複数LP対応）</div>
          <h1>サイト経由登録</h1>
          <div className="sub">
            各LP（<b>enger.jp</b> / <b>無限道場</b> など）と中央 Supabase <b className="mono">public.profiles</b> を共有し、LP側で登録されると自動でここに表示されます。
            登録元バッジで <b>どのLPから／GitHub・メール・Google・フォーム</b> など登録方式の判別が可能。各行の「✦ マッチング」で候補者として取り込み、マッチング画面で案件を探せます。
          </div>
        </div>
      </div>

      {!available && (
        <div className="card" style={{ borderColor: "var(--color-warn, #e0a317)", color: "var(--color-ink-2)", fontSize: 13 }}>
          <b>未連携：</b> enger.jp 側のエンジニア情報（public.profiles）に接続できませんでした。Supabase の環境変数（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）と public.profiles テーブルの存在を確認してください。
        </div>
      )}

      <EngineersClient engineers={rows} actions={actions} scouts={scouts} applications={applications} />
    </div>
  );
}
