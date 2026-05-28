import { EngineersClient } from "@/components/EngineersClient";
import { listEngineers, listEngineerActions, listScouts, listApplications } from "@/lib/engineers";
import { MatchingTabs } from "@/components/MatchingTabs";

export const dynamic = "force-dynamic";

export default async function EngineersPage() {
  const [{ rows, available }, actions, scouts, applications] = await Promise.all([listEngineers(), listEngineerActions(), listScouts(), listApplications()]);

  return (
    <div className="page">
      <MatchingTabs active="engineers" />
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">ENGER · エンジャー登録（LP連携）</div>
          <h1>エンジャー登録</h1>
          <div className="sub">
            <b>enger.jp</b>（GitHub連携）で本人が登録したエンジニアです。中央 Supabase <b className="mono">public.profiles</b> を共有しており、LP側で登録されると自動でここに表示されます。スキル・想定単価は GitHub 解析に基づく参考値です。
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
