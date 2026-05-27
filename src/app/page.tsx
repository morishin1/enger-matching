import { ClientHome } from "@/components/ClientHome";
import { AgentDashboard } from "@/components/AgentDashboard";
import { AdminGrowthBoard } from "@/components/AdminGrowthBoard";
import { CostReport } from "@/components/CostReport";
import { ReportIssues } from "@/components/ReportIssues";
import { WorkHome } from "@/components/WorkHome";
import { TalentRequests } from "@/components/TalentRequests";
import { currentAccess } from "@/lib/accounts";
import { hasSalesFunction } from "@/lib/roles";
import { listTalentRequests } from "@/lib/engineers";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const access = await currentAccess();
  // ユーザー企業 → 自社ポータル
  if (access?.role === "client") {
    return <ClientHome companyName={access.companyName} displayName={access.name} />;
  }
  // 非営業の一般職（バックオフィス/EC/サポート等・営業職能を持たない） → 業務ホーム
  const fns = access?.functions ?? [];
  if (access?.role === "agent" && !hasSalesFunction(fns)) {
    return <WorkHome name={access?.name ?? ""} functions={fns} />;
  }
  // 営業・管理者 → 企業からの人材リクエスト ＋ 経営/営業ダッシュボード
  const isAdmin = access?.role !== "agent"; // admin（または認証未設定のローカル）
  const talentRequests = await listTalentRequests();
  return (
    <>
      {talentRequests.length > 0 && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <TalentRequests rows={talentRequests} />
        </div>
      )}
      {isAdmin && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <AdminGrowthBoard />
          <ReportIssues />
          <CostReport />
        </div>
      )}
      <AgentDashboard role={access?.role === "agent" ? "agent" : "admin"} myName={access?.name ?? null} position={access?.position ?? null} />
    </>
  );
}
