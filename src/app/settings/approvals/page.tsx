import { redirect } from "next/navigation";
import { ApprovalsView } from "@/components/ApprovalsView";
import { currentAccess, listAccounts } from "@/lib/accounts";
import { getStaff } from "@/lib/staff";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const access = await currentAccess();
  // 管理者・エージェントが利用可能（agent は admin ロール付与・admin の操作は不可）
  if (access && access.role !== "admin" && access.role !== "agent") redirect("/");

  const accounts = await listAccounts();
  const staff = await getStaff();
  const agentOptions = staff.rows
    .filter((s: any) => s.active !== false && (s.email || s.name))
    .map((s: any) => ({ email: s.email ?? null, name: s.name ?? null }));
  const pending = accounts.filter((a) => a.status === "pending").length;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Approvals · 新規登録の承認</div>
          <h1>新規登録（承認）{pending > 0 && <span className="badge hot" style={{ marginLeft: 8, fontSize: 12 }}>{pending} 件待ち</span>}</h1>
          <div className="sub">自己登録したアカウントを<b>企業 / 人材 / 営業</b>のタブで切り分けて承認します。承認すると、その区分のダッシュボード・ポータルを利用できるようになります。</div>
        </div>
      </div>

      <ApprovalsView accounts={accounts} agents={agentOptions} />
    </div>
  );
}
