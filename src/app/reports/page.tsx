import { ReportsClient } from "@/components/ReportsClient";
import { MyDailyScorecard } from "@/components/MyDailyScorecard";
import { getActuals, listReports } from "@/lib/daily-report";
import { getMyScorecard } from "@/lib/me-scorecard";
import { currentAccess, listDepartmentMemberNames } from "@/lib/accounts";
import { getStaff } from "@/lib/staff";
import { unreadReplyCount } from "@/lib/notifications";
import { canManageDept } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const access = await currentAccess();
  const author = access?.name ?? "";
  const isAdmin = access?.role === "admin";
  const isManager = canManageDept(access?.teamRole); // マネージャー/リーダー
  const dept = access?.department ?? null;
  const today = new Date().toISOString().slice(0, 10);

  // 閲覧範囲の決定:
  //   admin            → 全員
  //   manager/leader   → 自部署メンバーのみ（部署が設定されている場合）
  //   それ以外         → 自分のみ
  let deptMembers: string[] = [];
  let reportsPromise;
  if (isAdmin) {
    reportsPromise = listReports({ limit: 400 });
  } else if (isManager && dept) {
    deptMembers = await listDepartmentMemberNames(dept);
    // 自分も含める（マスタ未設定で漏れないよう）
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

  // メンバー一覧（カレンダー用）：admin=全staff、manager=自部署メンバー、それ以外=自分
  const members = isAdmin ? staff.rows.map((r) => r.name).filter(Boolean)
    : isManager && dept ? deptMembers
    : (author ? [author] : []);

  // 返信できる権限：admin または マネージャー/リーダー（自部署）
  const canReply = isAdmin || (isManager && !!dept);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Daily Report · 日報{isAdmin ? "（管理）" : isManager && dept ? `（${dept}）` : ""}</div>
          <h1>日報{replyUnread > 0 && !canReply ? <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: "#fdecef", color: "#b42318", verticalAlign: "middle" }}>🔔 新着返信 {replyUnread}</span> : null}</h1>
          <div className="sub">
            {isAdmin
              ? <>全メンバーの日報を管理します。<b>カレンダーで提出・返信状況</b>を確認し、各日報に返信できます。</>
              : isManager && dept
                ? <><b>{dept}</b> 部署のメンバーの日報を確認・返信できます。</>
                : <>数値はシステムが自動集計。あなたは<b>「気づき」と「明日の一手」</b>だけ書けばOK。{replyUnread > 0 ? <b style={{ color: "#b42318" }}> 管理者から新着返信が {replyUnread} 件あります（お知らせを確認）。</b> : null}</>}
          </div>
        </div>
      </div>

      {!isAdmin && !author && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          アカウントに氏名が紐づいていないため実績の自動集計ができません。設定→担当者マスタ／アカウント管理で氏名を設定してください（日報自体は記入できます）。
        </div>
      )}

      {author && <MyDailyScorecard s={scorecard} />}
      <ReportsClient author={author} today={today} actuals={actuals} reports={reports} isAdmin={isAdmin} canReply={canReply} members={members} />
    </div>
  );
}
