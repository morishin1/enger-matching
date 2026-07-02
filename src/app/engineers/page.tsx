import { EngineersClient } from "@/components/EngineersClient";
import { MatchingPeerTabsServer } from "@/components/MatchingPeerTabsServer";
import { QuickAccessButtons } from "@/components/QuickAccessButtons";
import { UrlPeriodChips } from "@/components/UrlPeriodChips";
import { FlowSteps } from "@/components/FlowSteps";
import { listEngineers, listEngineerActions, listScouts, listApplications, listJobFavorites } from "@/lib/engineers";
import { listEngineerChatStatus, resolveEngineerProfileNames, type EngineerProfileName } from "@/lib/chat";
import { currentAccess } from "@/lib/accounts";
import { asClientPeriod, hasCustomRange, inClientPeriod, inCustomRange, CLIENT_PERIOD_KEYS, type ClientPeriod } from "@/lib/period";

export const dynamic = "force-dynamic";

export default async function EngineersPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; q?: string }> }) {
  const sp = await searchParams;
  const access = await currentAccess();
  const [{ rows, available }, actions, scouts, applications, favorites, chatStatus] = await Promise.all([
    listEngineers(), listEngineerActions(), listScouts(), listApplications(), listJobFavorites(), listEngineerChatStatus(access?.email),
  ]);
  // フリーランス詳細モーダル用：プロフィール登録の 姓名(漢字)/フリガナ/イニシャル を id 別に解決。
  const profileNames = Object.fromEntries(
    (await resolveEngineerProfileNames(rows.map((r) => r.id))).entries(),
  ) as Record<string, EngineerProfileName>;

  // 期間セレクタ（統一デザイン）。登録日(created_at)で一覧を絞り込む。既定=全期間。
  const mPeriod = asClientPeriod(sp.period, "all");
  const mCustom = hasCustomRange(sp.from, sp.to);
  const inPeriod = (d: string | null | undefined) =>
    mCustom ? inCustomRange(d, sp.from, sp.to) : inClientPeriod(d, mPeriod);
  const periodCounts = Object.fromEntries(
    CLIENT_PERIOD_KEYS.map((k) => [k, k === "all" ? rows.length : rows.filter((r) => inClientPeriod(r.created_at, k)).length]),
  ) as Partial<Record<ClientPeriod, number | null>>;
  const shownRows = (mCustom || mPeriod !== "all") ? rows.filter((r) => inPeriod(r.created_at)) : rows;

  return (
    <div className="page">
      {/* タブを最上段に置く（LINEと同じ配置。タブ移動時に段差が出ないようにする）。 */}
      <MatchingPeerTabsServer rightSlot={<UrlPeriodChips basePath="/engineers" counts={periodCounts} />} />

      <div className="page-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 820 }}>
          <div className="meta">ENGER · LP登録（各ランディングページ経由）</div>
          <h1>LP登録</h1>
          <div className="sub">
            <b>ENGERフリーランス（enger.jp）</b>から中央 Supabase <b className="mono">public.profiles</b> へ登録された人材を自動表示します（無限道場の登録者は表示対象外）。
            取り込みは自動同期され、人材一覧（/people）に「ENGERフリーランス」タグ付きで反映されます。面談を実施したら各行の「面談済」にチェックを入れて記録できます。
            <br />
            <span className="muted" style={{ fontSize: 11.5 }}>※ 正確な判別には profiles に <code>signup_source</code> / <code>signup_method</code> 列の保存を推奨（未実装でもヒューリスティックで判定）。</span>
          </div>
        </div>
        <div style={{ flexShrink: 0 }}><QuickAccessButtons /></div>
      </div>

      <FlowSteps current="mail" sub="LP経由のエンジニア取込" />

      {!available && (
        <div className="card" style={{ borderColor: "var(--color-warn, #e0a317)", color: "var(--color-ink-2)", fontSize: 13 }}>
          <b>未連携：</b> enger.jp 側のエンジニア情報（public.profiles）に接続できませんでした。Supabase の環境変数（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）と public.profiles テーブルの存在を確認してください。
        </div>
      )}

      <EngineersClient engineers={shownRows} actions={actions} scouts={scouts} applications={applications} favorites={favorites} profileNames={profileNames} chatStatus={chatStatus} initialQ={sp.q ?? ""} />
    </div>
  );
}
