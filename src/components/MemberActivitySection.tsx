// ダッシュボード用「メンバー別アクティビティ（今日）」セクション。
//   KPI推移（/kpi）上部と同じ表を、ダッシュボードにも出す（admin/マネージャー/リーダー）。
//   期間は「今日」。メンバーは staff(active) ∪ proposal_owners で解決し、各自の週次目標を按分。
//   詳細・期間切替は /kpi へ。

import Link from "next/link";
import { resolveActivityMembers } from "@/lib/activity-members";
import { getTeamActivity } from "@/lib/team-activity";
import { resolveRange, getWeeklyTargets, jstStartOfWeek, scaleWeeklyTarget, METRIC_ORDER, type Metric } from "@/lib/kpi";
import { loadProposalOwners } from "@/lib/proposal-owners";
import { canManageDept } from "@/lib/roles";
import { TeamActivityBoard } from "./TeamActivityBoard";

export async function MemberActivitySection({ access }: {
  access: { role: string; teamRole?: string | null; department?: string | null };
}) {
  const members = await resolveActivityMembers(access);
  if (members.length === 0) return null;

  const { start, end } = resolveRange("day");
  const rows = await getTeamActivity({ start, end, members });

  // チーム目標（按分済み）と提案者・CL リストを取得
  const weekStart = jstStartOfWeek(new Date());
  const teamWeekly = await getWeeklyTargets({ ownerEmail: null, weekStart });
  const teamTarget: Partial<Record<Metric, number>> = {};
  for (const m of METRIC_ORDER) teamTarget[m] = scaleWeeklyTarget(teamWeekly[m] ?? 0, "day", { start, end });
  const owners = (await loadProposalOwners()) ?? { proposers: [], closers: [] };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <Link href="/kpi" className="btn ghost btn-xs" style={{ textDecoration: "none" }}>📊 KPI推移・目標を編集 →</Link>
      </div>
      <TeamActivityBoard rows={rows} periodLabel="今日"
        teamTarget={teamTarget} weekStart={weekStart.toISOString().slice(0, 10)}
        viewer={{ role: access.role, teamRole: access.teamRole ?? null, isAdmin: access.role === "admin", isManager: canManageDept(access.teamRole ?? null) }}
        proposalOwners={owners} />
    </div>
  );
}
