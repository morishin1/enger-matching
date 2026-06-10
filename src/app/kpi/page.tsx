// 個人 KPI ダッシュボード（/kpi）。
//   - 期間切替: 日 / 週 / 月 / 四半期 / カレンダー任意
//   - 7 指標（提案 / CL / ○ / × / PC=受託 / N=EC / 打合せ）の達成率
//   - 推移グラフ（直近12期間）
//   - 管理者は「対象メンバー」を切替可能、メンバー以外は自分のみ
//   - 「目標を編集」モーダルで週次目標をその場で設定

import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { getKpiSnapshot, getKpiHistory, getKpiHistoryTable, getWeeklyTargets, jstStartOfWeek, type PeriodType, type Metric } from "@/lib/kpi";
import { getTeamActivity } from "@/lib/team-activity";
import { resolveActivityMembers } from "@/lib/activity-members";
import { KpiDashboardClient } from "@/components/KpiDashboardClient";
import { TeamActivityBoard } from "@/components/TeamActivityBoard";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";

const PERIOD_LABEL: Record<PeriodType, string> = { day: "今日", week: "今週", month: "今月", quarter: "今四半期", custom: "指定期間" };

export const dynamic = "force-dynamic";

export default async function KpiDashboardPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; owner?: string }> }) {
  const access = await currentAccess();
  if (!access) return <div style={{ padding: 24 }}>ログインが必要です。</div>;
  if (!dbConfigured) return <div style={{ padding: 24 }}>DB 接続が設定されていません。</div>;

  const sp = await searchParams;
  // 既定は「今日」。各メンバーの当日の動きをまず見せる。
  const period: PeriodType = (["day", "week", "month", "quarter", "custom"] as const).includes(sp.period as any)
    ? (sp.period as PeriodType) : "day";

  // 管理者は ?owner=email で対象切替可能。?owner=__team__ でチーム全体。それ以外は自分のみ。
  const isTeam = access.role === "admin" && sp.owner === "__team__";
  let targetEmail: string | null = access.email.toLowerCase();
  let targetName  = access.name ?? "";
  if (isTeam) {
    targetEmail = null; targetName = "チーム全体";
  } else if (access.role === "admin" && sp.owner) {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name, email").ilike("email", sp.owner).maybeSingle();
    if (r.data) { targetEmail = (r.data.email ?? "").toLowerCase(); targetName = r.data.name ?? ""; }
  }

  // 名前未解決（app_users.name が空の場合）→ staff から email で引く
  if (!isTeam && !targetName && targetEmail) {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name").ilike("email", targetEmail).maybeSingle();
    targetName = r.data?.name ?? "";
  }

  // ITS メンバー一覧（管理者の切替用）
  let members: { name: string; email: string }[] = [];
  if (access.role === "admin") {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name, email")
      .eq("active", true).not("email", "is", null).order("name");
    members = (r.data ?? []).filter((s: any) => s.email);
  }

  // 期間スナップショット
  const weekStart = jstStartOfWeek(new Date());
  const weekly = await getWeeklyTargets({ ownerEmail: targetEmail, weekStart });
  const custom = (period === "custom" && sp.from && sp.to) ? { from: sp.from, to: sp.to } : undefined;
  const { range, snapshot } = await getKpiSnapshot({
    ownerName: isTeam ? null : (targetName || null),
    type: period, custom, weeklyTargets: weekly,
  });

  // 推移グラフ（custom は推移を取らない）
  const historyType: Exclude<PeriodType, "custom"> = period === "custom" ? "week" : period;
  const history = await getKpiHistory({
    ownerName: isTeam ? null : (targetName || null), ownerEmail: targetEmail,
    type: historyType, periods: 12, metric: "proposal",
  });
  // 推移テーブル（全指標 × 期間の実績/目標）。日/週は12期間、月は12ヶ月、四半期は8期間。
  const tablePeriods = historyType === "day" ? 14 : historyType === "month" ? 12 : historyType === "quarter" ? 8 : 12;
  const historyTable = await getKpiHistoryTable({
    ownerName: isTeam ? null : (targetName || null), ownerEmail: targetEmail,
    type: historyType, periods: tablePeriods,
  });

  // メンバー別アクティビティ（誰が何をやったか）。admin/経営=全員、マネージャー/リーダー=自部署。
  //   メンバーは staff(active) ∪ proposal_owners で解決（3名固定にならず、編集UIから増減できる）。
  const activityMembers = await resolveActivityMembers({
    role: access.role, teamRole: access.teamRole, department: access.department,
  });
  const activity = activityMembers.length > 0
    ? await getTeamActivity({ start: range.start, end: range.end, members: activityMembers })
    : [];

  return (
    <>
      <div style={{ padding: "16px 18px 0" }}>
        <AnalyticsTabs />
      </div>
      {activity.length > 0 && (
        <div style={{ padding: "0 18px" }}>
          <TeamActivityBoard rows={activity} periodLabel={PERIOD_LABEL[period]} />
        </div>
      )}
      <KpiDashboardClient
        access={{ email: access.email, name: access.name, role: access.role }}
        target={{ email: isTeam ? "__team__" : (targetEmail ?? ""), name: targetName }}
        scope={isTeam ? "team" : "person"}
        members={members}
        period={period}
        range={{ start: range.start.toISOString(), end: range.end.toISOString() }}
        custom={custom ?? null}
        snapshot={snapshot}
        weeklyTargets={weekly as Partial<Record<Metric, number>>}
        weekStart={weekStart.toISOString().slice(0, 10)}
        history={history}
        historyTable={historyTable}
        historyPeriodLabel={PERIOD_LABEL[historyType]}
      />
    </>
  );
}
