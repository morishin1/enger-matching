// 提案管理タブに日報(MyDailyScorecard + ReportsClient)を埋め込むためのサーバ側ローダー。
//   src/app/reports/page.tsx のデータ取得ロジックを再現し、クライアントへ渡す props を返す。
//   ※ /reports ページ本体には手を入れず、こちらは埋め込み専用。
import { getActuals, listReports } from "@/lib/daily-report";
import { getMyScorecard } from "@/lib/me-scorecard";
import { listDepartmentMemberNames } from "@/lib/accounts";
import { getStaff } from "@/lib/staff";
import { unreadReplyCount } from "@/lib/notifications";
import { loadReportScopes, effectiveReportScope } from "@/lib/report-scope";
import { EXEC_DEPARTMENT } from "@/lib/roles";

export type ReportsAccess = { email: string; name: string | null; role: string | null; rawRole: string | null; teamRole: string | null; department: string | null } | null;

/** ReportsClient / MyDailyScorecard に渡す埋め込み用データを返す。 */
export async function loadReportsView(access: ReportsAccess) {
  const author = access?.name ?? "";
  const dept = access?.department ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const isTrueAdmin = !access || access.rawRole === "admin";

  const scopes = await loadReportScopes();
  const scope = effectiveReportScope(access?.role ?? null, access?.teamRole ?? null, scopes);
  const effective = scope === "dept" && !dept ? "self" : scope;

  let deptMembers: string[] = [];
  let reportsPromise;
  if (effective === "all") {
    reportsPromise = listReports({ limit: 400 });
  } else if (effective === "dept" && dept) {
    deptMembers = await listDepartmentMemberNames(dept);
    if (author && !deptMembers.includes(author)) deptMembers.push(author);
    reportsPromise = listReports({ authors: deptMembers, limit: 400 });
  } else {
    reportsPromise = listReports({ author, limit: 120 });
  }

  const execMembersPromise = isTrueAdmin ? Promise.resolve([] as string[]) : listDepartmentMemberNames(EXEC_DEPARTMENT);

  const [actuals, reportsRaw, staff, replyUnread, scorecard, execMembers] = await Promise.all([
    getActuals(author),
    reportsPromise,
    getStaff(),
    unreadReplyCount(author),
    getMyScorecard(author || null, access?.email ?? null),
    execMembersPromise,
  ]);

  const execSet = new Set(execMembers.map((n) => (n ?? "").trim()).filter(Boolean));
  const hideExecAuthor = (name?: string | null) =>
    !isTrueAdmin && !!name && execSet.has(String(name).trim()) && String(name).trim() !== author;
  const reports = (reportsRaw as any[]).filter((r) => !hideExecAuthor(r.author));

  const members = (effective === "all" ? staff.rows.map((r) => r.name).filter(Boolean)
    : effective === "dept" ? deptMembers
    : (author ? [author] : [])).filter((n: string) => !hideExecAuthor(n));

  const canReply = effective === "all" || effective === "dept";

  return {
    author,
    today,
    scorecard,
    replyUnread,
    canReply,
    reportsClient: {
      author, today, actuals, reports,
      isAdmin: effective === "all",
      canReply,
      canSubmit: !isTrueAdmin,
      members,
      reviewKind: (access?.role === "admin" ? "admin" : effective === "dept" ? "manager" : null) as "admin" | "manager" | null,
    },
  };
}
