// 提案管理タブに KPI ダッシュボード(KpiDashboardClient)を埋め込むためのサーバ側ローダー。
//   src/app/kpi/page.tsx のロジックのうち、KpiDashboardClient に渡す props 部分のみを再現する
//   （メンバー別アクティビティ／チーム目標ボードは含めない＝「KPI推移」に集中）。
//   ※ /kpi ページ本体には手を入れず、こちらは埋め込み専用。
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import {
  getKpiSnapshot, getKpiHistory, getKpiHistoryTable, getWeeklyTargets,
  jstStartOfWeek, cumulateMode, type PeriodType, type Metric,
} from "@/lib/kpi";
import { canManageDept } from "@/lib/roles";

const PERIOD_LABEL: Record<PeriodType, string> = { day: "今日", week: "今週", month: "今月", quarter: "今四半期", custom: "指定期間" };

export type KpiAccess = { email: string; name: string | null; role: string; teamRole: string | null };
export type KpiSearch = { period?: string; from?: string; to?: string; owner?: string };

/** KpiDashboardClient にそのまま渡せる props を返す。DB 未設定時は null。 */
export async function loadKpiClientProps(access: KpiAccess, sp: KpiSearch) {
  if (!dbConfigured) return null;
  try {
    const period: PeriodType = (["day", "week", "month", "quarter", "custom"] as const).includes(sp.period as any)
      ? (sp.period as PeriodType) : "day";

    const isTeam = sp.owner === "__team__";
    let targetEmail: string | null = access.email.toLowerCase();
    let targetName = access.name ?? "";
    if (isTeam) { targetEmail = null; targetName = "チーム全体"; }
    else if (access.role === "admin" && sp.owner) {
      const sb = engerAdmin();
      const r: any = await sb.from("staff").select("name, email").ilike("email", sp.owner).maybeSingle();
      if (r.data) { targetEmail = (r.data.email ?? "").toLowerCase(); targetName = r.data.name ?? ""; }
    }
    if (!isTeam && !targetName && targetEmail) {
      const sb = engerAdmin();
      const r: any = await sb.from("staff").select("name").ilike("email", targetEmail).maybeSingle();
      targetName = r.data?.name ?? "";
    }

    let members: { name: string; email: string }[] = [];
    if (access.role === "admin") {
      const sb = engerAdmin();
      const r: any = await sb.from("staff").select("name, email").eq("active", true).not("email", "is", null).order("name");
      members = (r.data ?? []).filter((s: any) => s.email);
    }

    const weekStart = jstStartOfWeek(new Date());
    const weekly = await getWeeklyTargets({ ownerEmail: targetEmail, weekStart });
    const custom = (period === "custom" && sp.from && sp.to) ? { from: sp.from, to: sp.to } : undefined;
    const { range, snapshot } = await getKpiSnapshot({
      ownerName: isTeam ? null : (targetName || null), type: period, custom, weeklyTargets: weekly, cumulate: true,
    });
    const cumulate = cumulateMode(period);
    const historyType: Exclude<PeriodType, "custom"> = period === "custom" ? "week" : period;
    const history = await getKpiHistory({
      ownerName: isTeam ? null : (targetName || null), ownerEmail: targetEmail,
      type: historyType, periods: 12, metric: "proposal", cumulate,
    });
    const tablePeriods = historyType === "day" ? 14 : historyType === "month" ? 12 : historyType === "quarter" ? 8 : 12;
    const historyTable = await getKpiHistoryTable({
      ownerName: isTeam ? null : (targetName || null), ownerEmail: targetEmail,
      type: historyType, periods: tablePeriods, cumulate,
    });
    const viewerIsManager = canManageDept(access.teamRole);

    return {
      access: { email: access.email, name: access.name, role: access.role, isManager: viewerIsManager },
      target: { email: isTeam ? "__team__" : (targetEmail ?? ""), name: targetName },
      scope: (isTeam ? "team" : "person") as "team" | "person",
      members,
      period,
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      custom: custom ?? null,
      snapshot,
      weeklyTargets: weekly as Partial<Record<Metric, number>>,
      weekStart: weekStart.toISOString().slice(0, 10),
      history,
      historyTable,
      historyPeriodLabel: PERIOD_LABEL[historyType],
    };
  } catch {
    return null;
  }
}
