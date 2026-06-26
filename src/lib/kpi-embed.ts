// 提案管理タブに KPI ダッシュボード(KpiDashboardClient)を埋め込むためのサーバ側ローダー。
//   src/app/kpi/page.tsx のロジックのうち、KpiDashboardClient に渡す props 部分のみを再現する
//   （メンバー別アクティビティ／チーム目標ボードは含めない＝「KPI推移」に集中）。
//   ※ /kpi ページ本体には手を入れず、こちらは埋め込み専用。
import { engerAdmin, dbConfigured } from "@/lib/supabase";
import {
  getKpiSnapshot, getKpiHistory, getKpiHistoryTable, getWeeklyTargets,
  jstStartOfWeek, jstStartOfDay, addDays, resolveRange, scaleWeeklyTarget, METRIC_ORDER, type PeriodType, type Metric,
} from "@/lib/kpi";
import { getTeamActivity } from "@/lib/team-activity";
import { resolveActivityMembers } from "@/lib/activity-members";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { canManageDept } from "@/lib/roles";
import { getStageTargets } from "@/lib/stage-targets";
import { listPersonKgi, monthKey } from "@/lib/person-kgi";

const PERIOD_LABEL: Record<PeriodType, string> = { day: "今日", week: "今週", month: "今月", quarter: "今四半期", custom: "指定期間" };

export type KpiAccess = { email: string; name: string | null; role: string; teamRole: string | null; department: string | null };
export type KpiSearch = { period?: string; from?: string; to?: string; owner?: string };

/** KpiDashboardClient にそのまま渡せる props を返す。DB 未設定時は null。 */
export async function loadKpiClientProps(access: KpiAccess, sp: KpiSearch) {
  if (!dbConfigured) return null;
  try {
    // 「前日」は内部的には day を前日基準で集計する。それ以外は通常の期間タイプ。
    const isYesterday = sp.period === "yesterday";
    const period: PeriodType = isYesterday ? "day"
      : (["day", "week", "month", "quarter", "custom"] as const).includes(sp.period as any) ? (sp.period as PeriodType) : "day";
    // 集計の基準日（前日のみ昨日、それ以外は今日）。
    const base = isYesterday ? addDays(jstStartOfDay(new Date()), -1) : new Date();

    const isTeam = sp.owner === "__team__";
    let targetEmail: string | null = access.email.toLowerCase();
    let targetName = access.name ?? "";
    if (isTeam) { targetEmail = null; targetName = "チーム全体"; }
    else if (access.role === "admin" && sp.owner) {
      const sb = engerAdmin();
      const r: any = await sb.from("staff").select("name, email").ilike("email", sp.owner).maybeSingle();
      if (r.data) { targetEmail = (r.data.email ?? "").toLowerCase(); targetName = r.data.name ?? ""; }
    }
    if (!isTeam && targetEmail && !(access.role === "admin" && sp.owner)) {
      // KPI個人の対象名は staff 名（＝提案の担当者名）に合わせる（会社名等の表示名だと提案と
      //   一致せず個人KPIが0になるため、email から staff 名を引いて優先）。
      const sb = engerAdmin();
      const r: any = await sb.from("staff").select("name").ilike("email", targetEmail).maybeSingle();
      if (r.data?.name) targetName = r.data.name;
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
    // カード／グラフ／表とも「選択タブの期間そのまま」で集計（累計しない）。
    //   メンバー別アクティビティ表と同基準に揃え、サマリーカードとの乖離をなくす。
    const { range, snapshot } = await getKpiSnapshot({
      ownerName: isTeam ? null : (targetName || null), type: period, base, custom, weeklyTargets: weekly, cumulate: false,
    });
    const cumulate = "off" as const;
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

    const kpi = {
      access: { email: access.email, name: access.name, role: access.role, isManager: viewerIsManager },
      target: { email: isTeam ? "__team__" : (targetEmail ?? ""), name: targetName },
      scope: (isTeam ? "team" : "person") as "team" | "person",
      members,
      period: isYesterday ? "yesterday" : period,
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      custom: custom ?? null,
      snapshot,
      weeklyTargets: weekly as Partial<Record<Metric, number>>,
      weekStart: weekStart.toISOString().slice(0, 10),
      history,
      historyTable,
      historyPeriodLabel: isYesterday ? "前日" : PERIOD_LABEL[historyType],
    };

    // メンバー別アクティビティ（誰が何件・目標/実績/達成率）。/kpi と同じ算出。
    let teamActivity: any = null;
    try {
      const activityMembers = await resolveActivityMembers(
        { role: access.role, teamRole: access.teamRole, department: access.department },
        { allowMember: true },
      );
      const actRange = resolveRange(period, base, custom);
      const activity = activityMembers.length > 0
        ? await getTeamActivity({ start: actRange.start, end: actRange.end, members: activityMembers })
        : [];
      if (activity.length > 0) {
        const teamWeeklyForBoard = await getWeeklyTargets({ ownerEmail: null, weekStart });
        const teamTarget: Partial<Record<Metric, number>> = {};
        for (const m of METRIC_ORDER) teamTarget[m] = scaleWeeklyTarget(teamWeeklyForBoard[m] ?? 0, "custom", actRange);
        const proposalOwnersForBoard = (await loadProposalOwners()) ?? { proposers: [], closers: [] };
        teamActivity = {
          rows: activity,
          periodLabel: isYesterday ? "前日" : period === "day" ? "本日" : period === "month" ? "今月（月初からの累計）" : PERIOD_LABEL[period],
          teamTarget,
          teamWeeklyTarget: teamWeeklyForBoard as Partial<Record<Metric, number>>,
          weekStart: weekStart.toISOString().slice(0, 10),
          viewer: { role: access.role, teamRole: access.teamRole ?? null, isAdmin: access.role === "admin", isManager: viewerIsManager },
          proposalOwners: proposalOwnersForBoard,
        };
      }
    } catch { /* アクティビティ取得失敗時はKPIのみ表示 */ }

    // ステージ別の担当者目標 と メンバー別KGI（月次稼働化目標）。
    let stageTargets: Record<string, Record<string, number>> = {};
    let kgiByMember: Record<string, { placementTarget: number | null }> = {};
    try {
      stageTargets = await getStageTargets();
      const kgis = await listPersonKgi(monthKey(), access.role === "admin" ? undefined : { department: access.department });
      for (const k of kgis) {
        const nm = String(k.owner_name ?? "").trim();
        if (nm) kgiByMember[nm] = { placementTarget: k.placement_target ?? (k.targets?.placement ?? null) };
      }
    } catch { /* テーブル未整備でもKPIは表示 */ }

    return { kpi, teamActivity, stageTargets, kgiByMember };
  } catch {
    return null;
  }
}
