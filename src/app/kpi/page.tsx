// 個人 KPI ダッシュボード（/kpi）。
//   - 期間切替: 日 / 週 / 月 / 四半期 / カレンダー任意
//   - 7 指標（提案 / CL / ○ / × / PC=受託 / N=EC / 打合せ）の達成率
//   - 推移グラフ（直近12期間）
//   - 管理者は「対象メンバー」を切替可能、メンバー以外は自分のみ
//   - 「目標を編集」モーダルで週次目標をその場で設定

import { engerAdmin, dbConfigured } from "@/lib/supabase";
import { currentAccess } from "@/lib/accounts";
import { getKpiSnapshot, getKpiHistory, getKpiHistoryTable, getWeeklyTargets, jstStartOfWeek, scaleWeeklyTarget, resolveRange, METRIC_ORDER, type PeriodType, type Metric } from "@/lib/kpi";
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

  // KPI個人の対象名は staff 名（＝提案の担当者 proposer に使われる名前）に合わせる。
  //   アカウント表示名が会社名等で proposer と一致しないと個人KPIが0になるため、
  //   email から staff 名を引いて優先する（admin が対象を切替えた場合はその名前を使う）。
  if (!isTeam && targetEmail && !(access.role === "admin" && sp.owner)) {
    const sb = engerAdmin();
    const r: any = await sb.from("staff").select("name").ilike("email", targetEmail).maybeSingle();
    if (r.data?.name) targetName = r.data.name;
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
  // 達成率カードは「選択タブの期間そのまま」で集計（cumulate: false）。
  //   メンバー別アクティビティ表と同じ単純な期間合計に揃え、サマリーカードとの乖離をなくす。
  //   （以前は月初〜の累計表示だったため、日/週タブで表と数値が大きく食い違っていた。）
  const { range, snapshot } = await getKpiSnapshot({
    ownerName: isTeam ? null : (targetName || null),
    type: period, custom, weeklyTargets: weekly, cumulate: false,
  });

  // 推移グラフ・推移テーブルも累計せず各期間単体で表示（"off"）。カード／表と基準を統一。
  const cumulate = "off" as const;
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
  // メンバー別アクティビティ表は「選択タブの期間そのまま」で純粋な期間合計を集計する：
  //   日 → 本日単体（1日）／週 → 今週（月〜日）／月 → 今月（1日〜末日）／
  //   四半期 → 今四半期／任意カレンダー → 指定範囲。
  //   ※ グラフ・推移テーブル（KPIダッシュボード側）の「日ごと積み上げ累計」ロジックとは独立。
  //     ここはタブ選択期間の単純合計（積み上げない）。達成率カード（snapshot）にも影響させない。
  const actRange = resolveRange(period, new Date(), custom);
  const activity = activityMembers.length > 0
    ? await getTeamActivity({ start: actRange.start, end: actRange.end, members: activityMembers })
    : [];

  // メンバー別アクティビティ用のチーム目標（選択期間の営業日数に按分）と提案者・CLリスト。
  //   getTeamActivity の各メンバー目標と同じ「営業日比按分」で揃える（custom 経路）。
  const teamWeeklyForBoard = await getWeeklyTargets({ ownerEmail: null, weekStart });
  const teamTarget: Partial<Record<Metric, number>> = {};
  for (const m of METRIC_ORDER) teamTarget[m] = scaleWeeklyTarget(teamWeeklyForBoard[m] ?? 0, "custom", actRange);
  const proposalOwnersForBoard = (await loadProposalOwners()) ?? { proposers: [], closers: [] };
  const viewerIsManager = canManageDept(access.teamRole);

  return (
    <>
      <div style={{ padding: "16px 18px 0" }}>
        <AnalyticsTabs />
      </div>
      {activity.length > 0 && (
        <div style={{ padding: "0 18px" }}>
          {/* メンバー別アクティビティ表は選択タブの期間そのまま（純粋な期間合計）で集計。
              タイトルも選択期間に連動させる。
              day → 本日、week → 今週、month → 今月（＝月初〜末日。実質「月初からの累計」）、
              quarter → 今四半期、custom → 指定期間。 */}
          <TeamActivityBoard rows={activity} periodLabel={
            period === "day" ? "本日"
            : period === "month" ? "今月（月初からの累計）"
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
