import { ClientHome } from "@/components/ClientHome";
import { AgentDashboard } from "@/components/AgentDashboard";
import { currentAccess } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // ロール別ダッシュボード：ユーザー企業=自社ポータル / 営業・管理者=ワークリスト
  const access = await currentAccess();
  if (access?.role === "client") {
    return <ClientHome companyName={access.companyName} displayName={access.name} />;
  }
  return <AgentDashboard role={access?.role === "agent" ? "agent" : "admin"} myName={access?.name ?? null} />;
}
