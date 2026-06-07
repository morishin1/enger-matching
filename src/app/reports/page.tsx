import { ReportsClient } from "@/components/ReportsClient";
import { MyDailyScorecard } from "@/components/MyDailyScorecard";
import { getActuals, listReports } from "@/lib/daily-report";
import { getMyScorecard } from "@/lib/me-scorecard";
import { currentAccess, listDepartmentMemberNames } from "@/lib/accounts";
import { getStaff } from "@/lib/staff";
import { unreadReplyCount } from "@/lib/notifications";
import { loadReportScopes, effectiveReportScope, REPORT_SCOPE_LABEL } from "@/lib/report-scope";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const access = await currentAccess();
  const author = access?.name ?? "";
  const dept = access?.department ?? null;
  const today = new Date().toISOString().slice(0, 10);

  // 役職別の閲覧スコープを取得（管理者は常に all）。
  //   all  : 全員 / dept : 自部署メンバー / self : 自分のみ
  const scopes = await loadReportScopes();
  const scope = effectiveReportScope(access?.role ?? null, access?.teamRole ?? null, scopes);
  // 部署スコープでも部署が未設定なら自分のみに自動降格
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

  const [actuals, reports, staff, replyUnread, scorecard] = await Promise.all([
    getActuals(author),
    reportsPromise,
    getStaff(),
    unreadReplyCount(author),
    getMyScorecard(author || null, access?.email ?? null),
  ]);

  // メンバー一覧（カレンダー用）：all=全staff、dept=自部署メンバー、self=自分
  const members = effective === "all" ? staff.rows.map((r) => r.name).filter(Boolean)
    : effective === "dept" ? deptMembers
    : (author ? [author] : []);

  // 返信できる権限：all または dept スコープ（自分以外を閲覧できる立場）
  const canReply = effective === "all" || effective === "dept";

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Daily Report · 日報（{REPORT_SCOPE_LABEL[effective]}{effective === "dept" && dept ? ` / ${dept}` : ""}）</div>
          <h1>日報{replyUnread > 0 && !canReply ? <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: "#fdecef", color: "#b42318", verticalAlign: "middle" }}>🔔 新着返信 {replyUnread}</span> : null}</h1>
          <div className="sub">
            {effective === "all"
              ? <>全メンバーの日報を管理します。<b>カレンダーで提出・返信状況</b>を確認し、各日報に返信できます。</>
              : effective === "dept"
                ? <><b>{dept}</b> 部署のメンバーの日報を確認・返信できます。</>
                : <>数値はシステムが自動集計。あなたは<b>「気づき」と「明日の一手」</b>だけ書けばOK。{replyUnread > 0 ? <b style={{ color: "#b42318" }}> 管理者から新着返信が {replyUnread} 件あります（お知らせを確認）。</b> : null}
                    {scope === "dept" && !dept && <><br /><span style={{ color: "#b45309", fontSize: 11.5 }}>※ 役職に部署スコープが割当てられていますが、あなたのアカウントに部署が未設定のため「個人のみ」に降格しています。管理者に部署設定を依頼してください。</span></>}
                  </>}
          </div>
        </div>
      </div>

      {effective !== "all" && !author && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          アカウントに氏名が紐づいていないため実績の自動集計ができません。設定→担当者マスタ／アカウント管理で氏名を設定してください（日報自体は記入できます）。
        </div>
      )}

      {author && <MyDailyScorecard s={scorecard} />}
      <ReportsClient author={author} today={today} actuals={actuals} reports={reports} isAdmin={effective === "all"} canReply={canReply} members={members} />
    </div>
  );
}
