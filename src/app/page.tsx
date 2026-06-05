import { ClientHome } from "@/components/ClientHome";
import { AgentDashboard } from "@/components/AgentDashboard";
import { AdminGrowthBoard } from "@/components/AdminGrowthBoard";
import { CostReport } from "@/components/CostReport";
import { ReportIssues } from "@/components/ReportIssues";
import { CompanyStructure } from "@/components/CompanyStructure";
import { WorkHome } from "@/components/WorkHome";
import { TalentHome } from "@/components/TalentHome";
import { ReplyAlertBanner } from "@/components/ReplyAlertBanner";
import { PartnerHome } from "@/components/PartnerHome";
import { FreelanceHome } from "@/components/FreelanceHome";
import { TalentRequests } from "@/components/TalentRequests";
import { RecentActivity } from "@/components/RecentActivity";
import { DashboardInbox } from "@/components/DashboardInbox";
import { TeamProgress } from "@/components/TeamProgress";
import { currentAccess } from "@/lib/accounts";
import { hasSalesFunction, canManageDept } from "@/lib/roles";
import { listTalentRequests } from "@/lib/engineers";
import { getCompanyMatrix } from "@/lib/companies";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
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
    return <><ReplyAlertBanner name={access?.name ?? null} /><WorkHome name={access?.name ?? ""} functions={fns} /></>;
  }
  // 営業・管理者 → 企業からの人材リクエスト ＋ 経営/営業ダッシュボード
  const isAdmin = access?.role !== "agent"; // admin（または認証未設定のローカル）
  // マネージャー/リーダー：自部署メンバーの進捗を見せる
  const isManager = !isAdmin && canManageDept(access?.teamRole) && !!access?.department;
  const talentRequests = await listTalentRequests();
  const matrix = isAdmin ? await getCompanyMatrix() : null;
  return (
    <>
      <ReplyAlertBanner name={access?.name ?? null} />
      <div className="page" style={{ paddingBottom: 0 }}>
        <RecentActivity />
      </div>
      <DashboardInbox />
      {talentRequests.length > 0 && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <TalentRequests rows={talentRequests} />
        </div>
      )}
      {/* メンバー進捗：admin は全社、manager/leader は自部署。一般メンバーには出さない（自分の進捗は AgentDashboard 内の「あなたのKPI」を参照）。 */}
      {(isAdmin || isManager) && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <TeamProgress
            scope={isAdmin ? "all" : "department"}
            departmentName={isAdmin ? null : access?.department ?? null}
            myName={access?.name ?? null}
          />
        </div>
      )}
      {isAdmin && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <AdminGrowthBoard />
          <ReportIssues />
          {matrix && (matrix.endCount > 0 || matrix.partnerCount > 0) && (
            <>
              <div className="meta" style={{ marginTop: 4 }}>取引構造 · エンド/SI × パートナーSES</div>
              <CompanyStructure matrix={matrix} />
            </>
          )}
          <CostReport />
        </div>
      )}
      <AgentDashboard role={access?.role === "agent" ? "agent" : "admin"} myName={access?.name ?? null} position={access?.position ?? null} />
    </>
  );
}
