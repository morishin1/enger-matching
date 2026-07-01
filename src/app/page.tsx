import { ClientHome } from "@/components/ClientHome";
import { WorkHome } from "@/components/WorkHome";
import { TalentHome } from "@/components/TalentHome";
import { PartnerHome } from "@/components/PartnerHome";
import { FreelanceHome } from "@/components/FreelanceHome";
import { DashboardNews } from "@/components/DashboardNews";
import { KgiBoard } from "@/components/KgiBoard";
import { currentAccess } from "@/lib/accounts";
import { hasSalesFunction } from "@/lib/roles";
import { loadDashboardAlerts } from "@/lib/dashboard-alerts";
import { listNotifications } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const two = (n: number) => String(n).padStart(2, "0");

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
    return <WorkHome name={access?.name ?? ""} functions={fns} />;
  }

  // ── 営業・管理者：ダッシュボードは「① お知らせ・やること → ② KGI/KPI（当月・/kgi と連動）」──
  //   旧「KGI達成率（チーム別）— 選択した日」の KpiDashboardClient は非表示（要望）。
  const [alerts, notifications] = await Promise.all([
    loadDashboardAlerts(),
    listNotifications(access?.name ?? null),
  ]);
  const now = new Date();
  const mk = `${now.getFullYear()}-${two(now.getMonth() + 1)}-01`;

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ① お知らせ・やること */}
      <DashboardNews alerts={alerts} notifications={notifications} />
      {/* ② 今月のKGI/KPI（/kgi と連動）：シーズナリティ → 逆算KPI（月/週/日・実績・達成率）→ 週次カレンダー。
          各実績数値はクリックで根拠データ（/kgi/detail）へ。詳細・目標設定は /kgi。 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 20, color: "var(--color-brand-700)" }}>insights</span>
        <b style={{ fontSize: 15 }}>今月のKGI/KPI</b>
        <a href="/kgi" style={{ marginLeft: "auto", textDecoration: "none" }} className="btn ghost btn-xs">詳細・目標設定 →</a>
      </div>
      <KgiBoard month={mk} sections={["summary", "season", "monthly", "weekly"]} />
    </div>
  );
}
