import { ClientHome } from "@/components/ClientHome";
import { AgentDashboard } from "@/components/AgentDashboard";
import { WorkHome } from "@/components/WorkHome";
import { currentAccess } from "@/lib/accounts";
import { hasSalesFunction } from "@/lib/roles";

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
  // 営業・管理者 → 営業/経営ダッシュボード
  return <AgentDashboard role={access?.role === "agent" ? "agent" : "admin"} myName={access?.name ?? null} position={access?.position ?? null} />;
}
