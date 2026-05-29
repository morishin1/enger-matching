import { ReportsClient } from "@/components/ReportsClient";
import { getActuals, listReports } from "@/lib/daily-report";
import { currentAccess } from "@/lib/accounts";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const access = await currentAccess();
  const author = access?.name ?? "";
  const isAdmin = access?.role === "admin";
  const today = new Date().toISOString().slice(0, 10);
  const [actuals, reports, staff] = await Promise.all([
    getActuals(author),
    // 個人は自分の日報のみ／管理者は全員分
    listReports(isAdmin ? { limit: 400 } : { author, limit: 120 }),
    getStaff(),
  ]);
  const members = staff.rows.map((r) => r.name).filter(Boolean);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 760 }}>
          <div className="meta">Daily Report · 日報{isAdmin ? "（管理）" : ""}</div>
          <h1>日報</h1>
          <div className="sub">
            {isAdmin
              ? <>メンバーの日報提出状況を管理します。<b>カレンダーで誰がいつ提出したか</b>を確認し、週次・月次は<b>AI講評</b>でフィードバックできます。</>
              : <>数値はシステムが自動集計。あなたは<b>「気づき」と「明日の一手」</b>だけ書けばOK。事実と向き合うことで自分で改善点に気づくための日報です。</>}
          </div>
        </div>
      </div>

      {!isAdmin && !author && (
        <div className="card" style={{ background: "var(--color-brand-25)", border: "1px solid var(--color-brand-100)", fontSize: 13 }}>
          アカウントに氏名が紐づいていないため実績の自動集計ができません。設定→担当者マスタ／アカウント管理で氏名を設定してください（日報自体は記入できます）。
        </div>
      )}

      <ReportsClient author={author} today={today} actuals={actuals} reports={reports} isAdmin={isAdmin} members={members} />
    </div>
  );
}
