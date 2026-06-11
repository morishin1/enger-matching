import { ReportsClient } from "@/components/ReportsClient";
import { FlowSteps } from "@/components/FlowSteps";
import { MyDailyScorecard } from "@/components/MyDailyScorecard";
import { getActuals, listReports } from "@/lib/daily-report";
import { getMyScorecard } from "@/lib/me-scorecard";
import { currentAccess, listDepartmentMemberNames } from "@/lib/accounts";
import { getStaff } from "@/lib/staff";
import { unreadReplyCount } from "@/lib/notifications";
import { loadReportScopes, effectiveReportScope, REPORT_SCOPE_LABEL } from "@/lib/report-scope";
import { EXEC_DEPARTMENT, isExecDepartment } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const access = await currentAccess();
  const author = access?.name ?? "";
  const dept = access?.department ?? null;
  const today = new Date().toISOString().slice(0, 10);

  // ── 日報の閲覧ルール（シンプル固定）─────────────────────────────
  //   ・管理者（素の role=admin）  : 全員の日報（経営含む）
  //   ・経営部署（admin 昇格）     : 全員の日報。ただし経営メンバーの日報は除く（管理者のみ閲覧可）
  //   ・マネージャー/リーダー      : 自部署メンバーの日報
  //   ・メンバー                   : 自分のみ
  //   ・全員：自分の日報は常に提出できる（フォームは ReportsClient 側で常時表示）
  //   isTrueAdmin は「昇格前の素のロールが admin」。経営昇格(role=admin化)とは区別する。
  const isTrueAdmin = !access || access.rawRole === "admin";

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

  // 経営メンバーの氏名（管理者以外には経営の日報を見せないフィルタ用）
  const execMembersPromise = isTrueAdmin ? Promise.resolve([] as string[]) : listDepartmentMemberNames(EXEC_DEPARTMENT);

  const [actuals, reportsRaw, staff, replyUnread, scorecard, execMembers] = await Promise.all([
    getActuals(author),
    reportsPromise,
    getStaff(),
    unreadReplyCount(author),
    getMyScorecard(author || null, access?.email ?? null),
    execMembersPromise,
  ]);

  // 経営メンバーの日報は管理者のみ閲覧可。本人の分は本人に見せる。
  const execSet = new Set(execMembers.map((n) => (n ?? "").trim()).filter(Boolean));
  const hideExecAuthor = (name?: string | null) =>
    !isTrueAdmin && !!name && execSet.has(String(name).trim()) && String(name).trim() !== author;
  const reports = (reportsRaw as any[]).filter((r) => !hideExecAuthor(r.author));

  // メンバー一覧（カレンダー用）：all=全staff、dept=自部署メンバー、self=自分。
  // 経営メンバーは管理者以外のカレンダーから除外（提出状況も見せない）。
  const members = (effective === "all" ? staff.rows.map((r) => r.name).filter(Boolean)
    : effective === "dept" ? deptMembers
    : (author ? [author] : [])).filter((n: string) => !hideExecAuthor(n));

  // 返信できる権限：all または dept スコープ（自分以外を閲覧できる立場）
  const canReply = effective === "all" || effective === "dept";

  // ヘッダ表示用のスコープ説明（シンプル化したルールに合わせる）
  const scopeNote = effective === "all"
    ? (isTrueAdmin ? "全員（経営含む）" : `全員（${EXEC_DEPARTMENT}の日報は管理者のみ）`)
    : REPORT_SCOPE_LABEL[effective];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Daily Report · 日報（{scopeNote}{effective === "dept" && dept ? ` / ${dept}` : ""}）</div>
          <h1>日報{replyUnread > 0 && !canReply ? <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 99, background: "#fdecef", color: "#b42318", verticalAlign: "middle" }}>🔔 新着返信 {replyUnread}</span> : null}</h1>
          <div className="sub">
            {effective === "all"
              ? <>全メンバーの日報を管理します。<b>カレンダーで提出・返信状況</b>を確認し、各日報に返信できます。自分の日報も下のフォームから提出できます。</>
              : effective === "dept"
                ? <><b>{dept}</b> 部署のメンバーの日報を確認・返信できます。自分の日報も下のフォームから提出できます。</>
                : <>数値はシステムが自動集計。あなたは<b>「気づき」と「明日の一手」</b>だけ書けばOK。{replyUnread > 0 ? <b style={{ color: "#b42318" }}> 管理者から新着返信が {replyUnread} 件あります（お知らせを確認）。</b> : null}
                    {scope === "dept" && !dept && <><br /><span style={{ color: "#b45309", fontSize: 11.5 }}>※ 役職に部署スコープが割当てられていますが、あなたのアカウントに部署が未設定のため「個人のみ」に降格しています。管理者に部署設定を依頼してください。</span></>}
                  </>}
          </div>
        </div>
      </div>

      <FlowSteps current="progress" sub="日報（行動の振り返り）" />

      {!author && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          アカウントに氏名が紐づいていないため実績の自動集計ができません。設定→担当者マスタ／アカウント管理で氏名を設定してください（日報自体は記入できます）。
        </div>
      )}

      {author && <MyDailyScorecard s={scorecard} />}
      {/* 管理者（本来の admin）は日報不要：入力フォームを出さない（canSubmit=false）。経営・マネージャー等は提出可。 */}
      <ReportsClient author={author} today={today} actuals={actuals} reports={reports} isAdmin={effective === "all"} canReply={canReply} canSubmit={!isTrueAdmin} members={members} reviewKind={access?.role === "admin" ? "admin" : effective === "dept" ? "manager" : null} />
    </div>
  );
}
