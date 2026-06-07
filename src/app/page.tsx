import { ClientHome } from "@/components/ClientHome";
import { AgentDashboard } from "@/components/AgentDashboard";
import { AgentGoalsHero } from "@/components/AgentGoalsHero";
import { AdminOverview } from "@/components/AdminOverview";
import { WorkHome } from "@/components/WorkHome";
import { TalentHome } from "@/components/TalentHome";
import { ReplyAlertBanner } from "@/components/ReplyAlertBanner";
import { PartnerHome } from "@/components/PartnerHome";
import { FreelanceHome } from "@/components/FreelanceHome";
import { TalentRequests } from "@/components/TalentRequests";
import { DashboardInbox } from "@/components/DashboardInbox";
import { TeamProgress } from "@/components/TeamProgress";
import { currentAccess } from "@/lib/accounts";
import { hasSalesFunction, canManageDept } from "@/lib/roles";
import { listTalentRequests } from "@/lib/engineers";
import { getMyScorecard } from "@/lib/me-scorecard";

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

  // 管理者：1画面ダッシュボード（AdminOverview）に集約。詳細は /insights へ。
  if (isAdmin) {
    return (
      <>
        <ReplyAlertBanner name={access?.name ?? null} />
        <AdminOverview />
        {talentRequests.length > 0 && (
          <div className="page" style={{ paddingTop: 0 }}>
            <TalentRequests rows={talentRequests} />
          </div>
        )}
      </>
    );
  }

  // 営業エージェント：役職で2分岐し、ダッシュボードをシンプル化。
  //   メンバー（マネージャー/リーダー以外）→ 自分のKGI/KPIヒーローのみ。詳細は各画面で。
  //   マネージャー/リーダー → 自部署メンバーの進捗管理が中心。
  const isMemberOnly = !isManager;

  if (isMemberOnly) {
    const scorecard = (access?.name || access?.email) ? await getMyScorecard(access?.name ?? null, access?.email ?? null) : null;
    return (
      <>
        <ReplyAlertBanner name={access?.name ?? null} />
        {scorecard && (
          <div className="page">
            <AgentGoalsHero name={access?.name ?? null} s={scorecard} />
          </div>
        )}
        {talentRequests.length > 0 && (
          <div className="page" style={{ paddingTop: 0 }}>
            <TalentRequests rows={talentRequests} />
          </div>
        )}
      </>
    );
  }

  // マネージャー/リーダー：部署メンバーの進捗管理を中心に。
  //   ・上：自部署メンバーの個人KGI達成率・要対応の可視化（TeamProgress）
  //   ・下：従来の運用情報（受信箱・人材リクエスト）も保持
  return (
    <>
      <ReplyAlertBanner name={access?.name ?? null} />
      <div className="page" style={{ paddingBottom: 0 }}>
        <TeamProgress scope="department" departmentName={access?.department ?? null} myName={access?.name ?? null} />
      </div>
      {talentRequests.length > 0 && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <TalentRequests rows={talentRequests} />
        </div>
      )}
      <DashboardInbox />
      <AgentDashboard role="agent" myName={access?.name ?? null} position={access?.position ?? null} />
    </>
  );
}
