// タイムカード（社内バイト/副業向け）。
//   ・本人ビュー：月カレンダー＋出勤/退勤打刻＋月締申請
//   ・マネージャー/admin ビュー：自部署の承認待ちタブ
//   ・タイムカード対象でない通常ユーザーがアクセスしても、承認権限があれば
//     「承認待ち一覧だけ」を表示する。両方無ければ案内のみ。

import { redirect } from "next/navigation";
import { currentAccess } from "@/lib/accounts";
import { canManageDept } from "@/lib/roles";
import { getMyMonth, getApprovalQueue, getShiftApprovalQueue, currentYm } from "@/lib/timecard";
import { TimecardClient } from "@/components/TimecardClient";

export const dynamic = "force-dynamic";

export default async function TimecardPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const access = await currentAccess();
  if (!access?.email) redirect("/login?next=/timecard");

  const sp = await searchParams;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? "") ? (sp.ym as string) : currentYm();

  // 役割判定
  const isAdmin = access.role === "admin";
  const isManager = canManageDept(access.teamRole);
  const isTimecardUser = access.isTimecardUser;

  // タイムカード本人ビュー：「タイムカード対象」だけでなく、admin/マネージャー/リーダーも
  //   自分のシフト申請・勤怠を入力できるよう開放（承認者だけど自分の予定も入れる運用に対応）。
  const showSelf = isTimecardUser || isAdmin || isManager;
  const showApproval = isAdmin || isManager;

  const myEntries = showSelf ? await getMyMonth(access.email, ym) : [];
  const approvalQueue = showApproval
    ? await getApprovalQueue({ department: isAdmin ? null : access.department, ym })
    : [];
  // シフト申請（事前承認）の承認待ち。月に縛られないため ym は使わず全件。
  const shiftQueue = showApproval
    ? await getShiftApprovalQueue({ department: isAdmin ? null : access.department })
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Timecard · 勤怠（バイト/副業向け）</div>
          <h1>タイムカード</h1>
          <div className="sub">先に <b>シフト（予定）を申請</b>し、マネージャーが承認 → そのシフトに沿って打刻 → 月末に <b>月締申請</b> → 月単位で承認。承認シフトと異なる時間で働いた日は「シフト外で働いた理由」を入力してください。</div>
        </div>
      </div>

      <TimecardClient
        me={{ email: access.email, name: access.name ?? "", isAdmin, isManager, isTimecardUser: showSelf }}
        ym={ym}
        myEntries={myEntries}
        approvalQueue={approvalQueue}
        shiftQueue={shiftQueue}
      />

      {!showSelf && !showApproval && (
        <div className="card" style={{ background: "var(--color-brand-25)", borderColor: "var(--color-brand-100)", fontSize: 13 }}>
          タイムカードを使うには、管理者に「タイムカード対象」の有効化を依頼してください。
        </div>
      )}
    </div>
  );
}
