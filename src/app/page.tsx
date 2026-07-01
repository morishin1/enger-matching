import { ClientHome } from "@/components/ClientHome";
import { WorkHome } from "@/components/WorkHome";
import { TalentHome } from "@/components/TalentHome";
import { PartnerHome } from "@/components/PartnerHome";
import { FreelanceHome } from "@/components/FreelanceHome";
import { DashboardNews } from "@/components/DashboardNews";
import { DashboardKgiSummary } from "@/components/DashboardKgiSummary";
import { KpiDashboardClient } from "@/components/KpiDashboardClient";
import { currentAccess } from "@/lib/accounts";
import { hasSalesFunction } from "@/lib/roles";
import { loadDashboardAlerts } from "@/lib/dashboard-alerts";
import { listNotifications } from "@/lib/notifications";
import { loadKpiClientProps } from "@/lib/kpi-embed";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; owner?: string }> }) {
  const access = await currentAccess();
  const needGate = !!access && !access.meetingDone && (access.role === "client" || access.role === "candidate" || access.role === "partner" || access.role === "freelance");
  // ユーザー企業 → 自社ポータル
  if (access?.role === "client") {
    return <ClientHome companyName={access.companyName} displayName={access.name} needGate={needGate} />;
  }
  // 人材（エンジニア） → 人材ダッシュボード
  if (access?.role === "candidate") {
    return <TalentHome displayName={access.name} needGate={needGate} />;
  }
  // パートナー企業 → パートナーホーム
  if (access?.role === "partner") {
    return <PartnerHome companyName={access.companyName} displayName={access.name} />;
  }
  // 副業エージェント → 副業エージェントホーム（報酬ダッシュボード）
  if (access?.role === "freelance") {
    return <FreelanceHome displayName={access.name} email={access.email} />;
  }
  // 非営業の一般職（バックオフィス/EC/サポート等・営業職能を持たない） → 業務ホーム
  const fns = access?.functions ?? [];
  if (access?.role === "agent" && !hasSalesFunction(fns)) {
    return <WorkHome name={access?.name ?? ""} functions={fns} />;
  }

  // ── 営業・管理者：ダッシュボードは「① 新着ニュース → ② KPIダッシュボード」の2つだけ ──
  const sp = await searchParams;
  const [alerts, notifications, kpiData] = await Promise.all([
    loadDashboardAlerts(),
    listNotifications(access?.name ?? null),
    loadKpiClientProps(
      { email: access?.email ?? "", name: access?.name ?? null, role: access?.role ?? "", teamRole: access?.teamRole ?? null, department: access?.department ?? null },
      sp,
    ),
  ]);

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ① 新着ニュース（やるべきこと・日報・新規登録者などのメッセージ） */}
      <DashboardNews alerts={alerts} notifications={notifications} />
      {/* ② 今月のKGI/KPI サマリー（/kgi のデータと連動：売上目標・稼働/面談/提案/打合せ の達成率＋仕入れKGI） */}
      <DashboardKgiSummary />
      {/* ③ KPIダッシュボード（KGI達成率の4ボックスは KpiDashboardClient 内の「選択した日…」直上に表示） */}
      {kpiData?.kpi ? (
        <div className="card flush" style={{ overflow: "hidden" }}>
          <KpiDashboardClient {...(kpiData.kpi as React.ComponentProps<typeof KpiDashboardClient>)} />
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", color: "var(--color-ink-4)", padding: 40 }}>
          KPI を表示できません（ログイン情報またはDB設定をご確認ください）。
        </div>
      )}
    </div>
  );
}
