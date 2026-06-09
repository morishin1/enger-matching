// 詳細インサイトページ（管理者のみ）。
//   ダッシュボードのファーストビューをシンプル化するため、従来の重いセクションをここに退避。
//   成長ボード／取引構造／コスト／最近の活動／受信箱／自分のKPI を集約表示。

import Link from "next/link";
import { redirect } from "next/navigation";
import { currentAccess } from "@/lib/accounts";
import { FlowSteps } from "@/components/FlowSteps";
import { getCompanyMatrix } from "@/lib/companies";
import { AdminGrowthBoard } from "@/components/AdminGrowthBoard";
import { CostReport } from "@/components/CostReport";
import { ReportIssues } from "@/components/ReportIssues";
import { CompanyStructure } from "@/components/CompanyStructure";
import { RecentActivity } from "@/components/RecentActivity";
import { DashboardInbox } from "@/components/DashboardInbox";
import { AgentDashboard } from "@/components/AgentDashboard";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const access = await currentAccess();
  // 管理者・営業職以外はトップへ
  const isAdmin = !access || access.role === "admin";
  const isAgent = access?.role === "agent";
  if (!isAdmin && !isAgent) redirect("/");

  const matrix = isAdmin ? await getCompanyMatrix() : null;

  return (
    <>
      <div className="page">
        <div className="page-head">
          <div style={{ maxWidth: 760 }}>
            <div className="meta">Insights · 詳細分析</div>
            <h1>詳細インサイト</h1>
            <div className="sub">ダッシュボードの主要KGI/KPIを補完する詳細ビュー。成長指標・取引構造・コスト・最近の活動を確認できます。</div>
          </div>
          <Link href="/" className="btn ghost" style={{ textDecoration: "none", alignSelf: "flex-start" }}>← ダッシュボードへ</Link>
        </div>
        <FlowSteps current="progress" sub="詳細インサイト" />
        <RecentActivity />
      </div>
      <DashboardInbox />
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
