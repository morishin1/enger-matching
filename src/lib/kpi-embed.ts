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

    // 既定はチーム表示（owner 未指定）。個人タブを押すと owner=email が付く。
    const isTeam = sp.owner === "__team__" || !sp.owner;
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

    // ステージ目標ボードの「打ち合わせ」「案件の仕入れ」列のソースイベント（期間連動はクライアント側）。
    //   ・打ち合わせ：打合せ記録(meetings)の自社担当者(our_owner)×打ち合わせ日(meeting_date) を1件として集計。
    //   ・案件の仕入れ：承認済（companies.meeting_done=true）かつ自社担当者(owner_staff)記入済の企業から
    //     取り込んだ案件(jobs)を、その企業の owner_staff の実績として集計（案件側のみ・人材側は対象外）。
    //   compact な {date, owner} 配列で渡し、KPI推移の期間でクライアントが絞り込む。
    let meetingEvents: { date: string; owner: string }[] = [];
    let procurementEvents: { date: string; owner: string }[] = [];
    try {
      const sb = engerAdmin();
      // 企業名の正規化（jobs.client_name ⇔ companies.name の名寄せ）。companies.ts の compKey と同じ規則。
      const compKey = (s: string) => String(s || "").toLowerCase()
        .replace(/(株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|inc\.?|co\.?,?\s*ltd\.?|ltd\.?|corp\.?|corporation)/g, "")
        .replace(/[\s　()（）・,，、。.\-－_/／]/g, "");

      // ① 打ち合わせ：meeting_date が入っている記録を our_owner ごとに1件。
      const mr: any = await sb.from("meetings").select("our_owner, meeting_date").not("meeting_date", "is", null).limit(5000);
      for (const r of (mr?.data ?? [])) {
        const owner = String(r?.our_owner ?? "").trim();
        const date = r?.meeting_date ? String(r.meeting_date) : "";
        if (owner && date) meetingEvents.push({ date, owner });
      }

      // ② 案件の仕入れ：承認済＋自社担当者ありの企業マップを作り、その企業から取り込んだ案件を owner_staff に按分。
      let cr: any = await sb.from("companies").select("name, meeting_done, owner_staff").limit(20000);
      if (cr?.error && /meeting_done|owner_staff|column/i.test(cr.error.message ?? "")) cr = { data: [] };
      const compByKey = new Map<string, { meeting_done: boolean; owner_staff: string }>();
      for (const c of (cr?.data ?? [])) {
        const nm = String(c?.name ?? "").trim(); if (!nm) continue;
        compByKey.set(compKey(nm), { meeting_done: !!c?.meeting_done, owner_staff: String(c?.owner_staff ?? "").trim() });
      }
      let jr: any = await sb.from("jobs").select("client_name, created_at, imported_at").order("imported_at", { ascending: false, nullsFirst: false }).limit(8000);
      if (jr?.error) jr = await sb.from("jobs").select("client_name, created_at").order("created_at", { ascending: false }).limit(8000);
      for (const j of (jr?.data ?? [])) {
        const nm = String(j?.client_name ?? "").trim(); if (!nm) continue;
        const comp = compByKey.get(compKey(nm));
        if (!comp || !comp.meeting_done || !comp.owner_staff) continue; // 承認済＋自社担当者ありのみ
        const date = j?.imported_at ? String(j.imported_at) : (j?.created_at ? String(j.created_at) : "");
        if (date) procurementEvents.push({ date, owner: comp.owner_staff });
      }
    } catch { /* 取得失敗時は空配列のまま（他のKPIは表示） */ }

    return { kpi, teamActivity, stageTargets, kgiByMember, meetingEvents, procurementEvents };
  } catch {
    return null;
  }
}
