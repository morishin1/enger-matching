// 個人 KPI ダッシュボード（/kpi）。
//   - 期間切替: 日 / 週 / 月 / 四半期 / カレンダー任意
//   - 7 指標（提案 / CL / ○ / × / PC=受託 / N=EC / 打合せ）の達成率
//   - 推移グラフ（直近12期間）
//   - 管理者は「対象メンバー」を切替可能、メンバー以外は自分のみ
//   - 「目標を編集」モーダルで週次目標をその場で設定

import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { getKpiSnapshot, getKpiHistory, getKpiHistoryTable, getWeeklyTargets, jstStartOfWeek, scaleWeeklyTarget, cumulativeRange, cumulateMode, METRIC_ORDER, type PeriodType, type Metric } from "@/lib/kpi";
import { getTeamActivity } from "@/lib/team-activity";
import { resolveActivityMembers } from "@/lib/activity-members";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { canManageDept } from "@/lib/roles";
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

  // ?owner=__team__ ならチーム全体（全員参照可）。管理者は ?owner=email で他メンバーに切替可。
  // それ以外（マネージャー/一般）は自分のみ＋チーム閲覧。
  const isTeam = sp.owner === "__team__";
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
  // 達成率カードも累計表示（cumulate: true）。日/週は月初〜の積み上げ、四半期/任意/月は
  //   それぞれのレンジで実績・目標を積み上げる（cumulativeRange のルール。画面全体で統一）。
  const { range, snapshot } = await getKpiSnapshot({
    ownerName: isTeam ? null : (targetName || null),
    type: period, custom, weeklyTargets: weekly, cumulate: true,
  });

  // 累計（積み上げ）リセット境界：カード・グラフ・テーブルで共通（cumulateMode）。
  //   日/週/月 → 月境界でリセット（日・週はその月分のみ積み上げ、月は各月単体）／
  //   四半期 → 四半期内で積み上げ／任意カレンダー → 範囲全体を積み上げ。
  const cumulate = cumulateMode(period);
  // 推移グラフ（custom は週次で推移を取る）。達成率を累計で積み上げ（テーブルと同境界）。
  const historyType: Exclude<PeriodType, "custom"> = period === "custom" ? "week" : period;
  const history = await getKpiHistory({
    ownerName: isTeam ? null : (targetName || null), ownerEmail: targetEmail,
    type: historyType, periods: 12, metric: "proposal", cumulate,
  });
  // 推移テーブル（全指標 × 期間の実績/目標）。日/週は12期間、月は12ヶ月、四半期は8期間。
  const tablePeriods = historyType === "day" ? 14 : historyType === "month" ? 12 : historyType === "quarter" ? 8 : 12;
  const historyTable = await getKpiHistoryTable({
    ownerName: isTeam ? null : (targetName || null), ownerEmail: targetEmail,
    type: historyType, periods: tablePeriods, cumulate,
  });

  // メンバー別アクティビティ（誰が何をやったか）。admin/経営=全員、マネージャー/リーダー=自部署。
  //   メンバーは staff(active) ∪ proposal_owners で解決（3名固定にならず、編集UIから増減できる）。
  //   ※ 一般メンバーにも表示する（allowMember）。編集系ボタン（メンバー編集/チーム目標/
  //     メンバー目標）は TeamActivityBoard 側で admin/マネージャーのみ表示のまま。
  const activityMembers = await resolveActivityMembers({
    role: access.role, teamRole: access.teamRole, department: access.department,
  }, { allowMember: true });
  // メンバー別アクティビティ表は「累計レンジ」で集計する：
  //   日/週 → 月初〜（その月分のみ累計、新しい月でリセット）／四半期 → 四半期内累計
  //   任意カレンダー → 範囲そのまま（範囲全体で累計）／月 → 月単体（従来どおり）
  //   ※ 達成率カード（snapshot）には影響させない（要望スコープ＝表のみ累計）。
  const cumRange = cumulativeRange(period, new Date(), custom);
  const activity = activityMembers.length > 0
    ? await getTeamActivity({ start: cumRange.start, end: cumRange.end, members: activityMembers })
    : [];

  // メンバー別アクティビティ用のチーム目標（累計レンジに按分）と提案者・CLリスト
  const teamWeeklyForBoard = await getWeeklyTargets({ ownerEmail: null, weekStart });
  const teamTarget: Partial<Record<Metric, number>> = {};
  for (const m of METRIC_ORDER) teamTarget[m] = scaleWeeklyTarget(teamWeeklyForBoard[m] ?? 0, "custom", cumRange);
  const proposalOwnersForBoard = (await loadProposalOwners()) ?? { proposers: [], closers: [] };
  const viewerIsManager = canManageDept(access.teamRole);

  return (
    <>
      <div style={{ padding: "16px 18px 0" }}>
        <AnalyticsTabs />
      </div>
      {activity.length > 0 && (
        <div style={{ padding: "0 18px" }}>
          {/* メンバー別アクティビティ表は累計レンジで集計。表ラベルにも「累計」を明示する。
              day/week → 月初からの累計、quarter → 四半期内、custom → 期間内、month → 月単体。 */}
          <TeamActivityBoard rows={activity} periodLabel={
            period === "day" || period === "week" ? `${PERIOD_LABEL[period]}（月初からの累計）`
            : period === "quarter" ? `${PERIOD_LABEL[period]}（四半期累計）`
            : period === "custom" ? `${PERIOD_LABEL[period]}（範囲累計）`
            : PERIOD_LABEL[period]
          }
            teamTarget={teamTarget}
            teamWeeklyTarget={teamWeeklyForBoard as Partial<Record<Metric, number>>}
            weekStart={weekStart.toISOString().slice(0, 10)}
            viewer={{ role: access.role, teamRole: access.teamRole ?? null, isAdmin: access.role === "admin", isManager: viewerIsManager }}
            proposalOwners={proposalOwnersForBoard} />
        </div>
      )}
      <KpiDashboardClient
        access={{ email: access.email, name: access.name, role: access.role, isManager: viewerIsManager }}
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
